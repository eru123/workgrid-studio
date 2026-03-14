use std::fs;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use crate::files::ensure_app_dirs;
use crate::crypto::vault_get;

#[derive(Serialize)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct OpenAIPayload {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
}

#[derive(Deserialize)]
pub struct OpenAIChoice {
    pub message: OpenAIResponseMsg,
}

#[derive(Deserialize)]
pub struct OpenAIResponseMsg {
    pub content: String,
}

#[derive(Deserialize)]
pub struct OpenAIResponse {
    pub choices: Vec<OpenAIChoice>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AiLogEntry {
    pub id: String,
    pub timestamp: String,
    pub model: String,
    pub uri: String,
    pub payload_preview: String,
    pub response_preview: String,
}

pub fn append_ai_log(entry: AiLogEntry) {
    if let Ok(base) = ensure_app_dirs() {
        let path = base.join("ai_logs.json");
        let mut logs: Vec<AiLogEntry> = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };
        logs.push(entry);

        // Keep only last 100 logs to prevent unbounded growth
        if logs.len() > 100 {
            logs.remove(0);
        }

        if let Ok(serialized) = serde_json::to_string(&logs) {
            let _ = fs::write(path, serialized);
        }
    }
}

#[tauri::command]
pub fn get_ai_logs() -> Result<Vec<AiLogEntry>, String> {
    let base = ensure_app_dirs()?;
    let path = base.join("ai_logs.json");
    if !path.exists() {
         return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut logs: Vec<AiLogEntry> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    logs.reverse(); // Newest first
    Ok(logs)
}

#[tauri::command]
pub fn clear_ai_logs() -> Result<(), String> {
    let base = ensure_app_dirs()?;
    let path = base.join("ai_logs.json");
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_generate_query(
    provider_type: String, // "openai", "gemini", "deepseek", "other"
    base_url: Option<String>,
    api_key_ref: String,
    model_id: String,
    prompt: String,
    schema_context: String,
    current_query: Option<String>,
) -> Result<String, String> {
    let api_key = vault_get(api_key_ref)?;
    let client = Client::new();

    let system_prompt = format!(
        "You are an expert MySQL/MariaDB SQL assistant for Workgrid Studio. \
        Below is the complete DDL (CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION) \
        for the user's database:\n\n{}\n\n\
        Use this schema to understand indexes, constraints, relationships, and stored routines. \
        Generate the most optimized SQL query for the user's request. \
        If there are multiple approaches with different performance trade-offs, \
        output them as separate queries separated by a comment like -- Alternative: ... \
        Output ONLY raw SQL. Do not wrap it in markdown codeblocks (```sql ... ```). \
        Do not add explanations outside of SQL comments.",
        schema_context
    );

    let mut final_system_prompt = system_prompt.clone();
    if let Some(q) = current_query {
        if !q.trim().is_empty() {
            final_system_prompt.push_str(&format!("\n\nThe user's current SQL editor content is:\n```sql\n{}\n```\nUse this context if the user is asking to fix, modify, or extend their existing query.", q));
        }
    }

    let user_prompt = prompt;

    match provider_type.as_str() {
        "openai" | "deepseek" | "other" => {
            let url = base_url.unwrap_or_else(|| {
                if provider_type == "deepseek" {
                    "https://api.deepseek.com/chat/completions".to_string()
                } else {
                    "https://api.openai.com/v1/chat/completions".to_string()
                }
            });

            let default_model = if provider_type == "deepseek" { "deepseek-chat" } else { "gpt-4o" };
            let actual_model = if model_id.is_empty() { default_model.to_string() } else { model_id };

            let payload = OpenAIPayload {
                model: actual_model.clone(),
                messages: vec![
                    AnthropicMessage { role: "system".to_string(), content: final_system_prompt },
                    AnthropicMessage { role: "user".to_string(), content: user_prompt },
                ],
            };

            println!("Sending {} completion request to {} (model: {})", provider_type, url, actual_model);

            let payload_json = serde_json::to_string(&payload).unwrap_or_default();

            let res = client.post(&url)
                .bearer_auth(api_key)
                .json(&payload)
                .send()
                .await;

            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let entry_id = uuid::Uuid::new_v4().to_string();

            match res {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        let text = response.text().await.unwrap_or_default();
                        println!("AI Request Error ({}): {}", status, text);

                        append_ai_log(AiLogEntry {
                            id: entry_id,
                            timestamp,
                            model: actual_model.clone(),
                            uri: url.clone(),
                            payload_preview: payload_json,
                            response_preview: format!("HTTP {} - {}", status, text),
                        });

                        return Err(format!("API Error ({}): {}", status, text));
                    }

                    let raw_text = response.text().await.unwrap_or_default();
                    let parsed: OpenAIResponse = serde_json::from_str(&raw_text)
                        .map_err(|e| format!("Failed to parse response: {}\nRaw: {}", e, raw_text))?;

                    append_ai_log(AiLogEntry {
                        id: entry_id,
                        timestamp,
                        model: actual_model,
                        uri: url,
                        payload_preview: payload_json,
                        response_preview: raw_text,
                    });

                    if let Some(choice) = parsed.choices.first() {
                        let content = choice.message.content.trim().to_string();
                        // Strip markdown codeblocks if AI disobeyed
                let cleaned = content
                    .strip_prefix("```sql").unwrap_or(&content)
                    .strip_prefix("```").unwrap_or(&content)
                    .strip_suffix("```").unwrap_or(&content)
                    .trim()
                    .to_string();
                Ok(cleaned)
            } else {
                Err("No choices returned from AI provider".to_string())
            }
                },
                Err(e) => {
                    append_ai_log(AiLogEntry {
                        id: entry_id,
                        timestamp,
                        model: actual_model,
                        uri: url,
                        payload_preview: payload_json,
                        response_preview: format!("Connection failed: {}", e),
                    });
                    Err(format!("HTTP request failed: {}", e))
                }
            }
        },
        "gemini" => {
            // Very simple Gemini impl via proxy or google generative AI SDK format
            // Here assuming proxy to openai-compatible gemini endpoint
            let url = base_url.unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".to_string());

            let payload = OpenAIPayload {
                model: if model_id.is_empty() { "gemini-2.5-flash".to_string() } else { model_id },
                messages: vec![
                    AnthropicMessage { role: "system".to_string(), content: final_system_prompt },
                    AnthropicMessage { role: "user".to_string(), content: user_prompt },
                ],
            };

            let res = client.post(&url)
                .bearer_auth(api_key)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            let status = res.status();
            if !status.is_success() {
                let text = res.text().await.unwrap_or_default();
                return Err(format!("API Error ({}): {}", status, text));
            }

            let parsed: OpenAIResponse = res.json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            if let Some(choice) = parsed.choices.first() {
                let content = choice.message.content.trim().to_string();
                let cleaned = content
                    .strip_prefix("```sql").unwrap_or(&content)
                    .strip_prefix("```").unwrap_or(&content)
                    .strip_suffix("```").unwrap_or(&content)
                    .trim()
                    .to_string();
                Ok(cleaned)
            } else {
                Err("No choices returned from AI provider".to_string())
            }
        },
        _ => Err("Unsupported provider type".to_string())
    }
}

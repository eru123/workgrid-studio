// --------------------------------------------------------------- - 服务：扁平凭据存储 + 加密持久化。
// 通过 `services::crypto` 使用 AES-256-GCM，并确保在树响应中不返回敏感信息。
// 写入通过临时文件 + 重命名实现原子性。

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::models::{
    CredentialEntryDto, CredentialEntryInput, CredentialFields, CredentialKind, CredentialNode,
};
use crate::services::crypto::{decrypt_password, encrypt_password};
use crate::services::files::data_file_path;
use crate::{AppError, AppResult};
use serde::{Deserialize, Serialize};

const CREDENTIALS_FILE: &str = "credentials.json";

// ---------------------------------------------------------------- - 树响应 DTO

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialNodeRedacted {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<CredentialNodeRedacted>>,
}

impl CredentialNodeRedacted {
    fn folder(id: String, name: String) -> Self {
        Self {
            id,
            node_type: "folder".to_string(),
            name,
            description: None,
            kind: None,
            children: Some(vec![]),
        }
    }

    fn entry(id: String, kind: String, name: String, description: Option<String>) -> Self {
        Self {
            id,
            node_type: "entry".to_string(),
            name,
            description,
            kind: Some(kind),
            children: Some(vec![]),
        }
    }
}

// ------------------------------------------------------------- - 持久化形状

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    parent_id: Option<String>,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    fields: Option<CredentialFields>,
    #[serde(default)]
    children: Vec<PersistedNode>,
    #[serde(default)]
    expanded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

impl PersistedNode {
    fn folder(id: String, parent_id: Option<String>, name: String) -> Self {
        Self {
            id,
            node_type: "folder".to_string(),
            parent_id,
            name,
            description: None,
            kind: None,
            fields: None,
            children: vec![],
            expanded: true,
            created_at: None,
            updated_at: None,
        }
    }

    fn entry(
        id: String,
        parent_id: Option<String>,
        kind: CredentialKind,
        name: String,
        fields: CredentialFields,
        description: Option<String>,
        created_at: Option<String>,
        updated_at: Option<String>,
    ) -> Self {
        Self {
            id,
            node_type: "entry".to_string(),
            parent_id,
            name,
            description,
            kind: Some(kind.to_string()),
            fields: Some(fields),
            children: vec![],
            expanded: false,
            created_at,
            updated_at,
        }
    }
}

// -------------------------------------------------------- - 扁平存储

#[derive(Debug, Default)]
struct FlatStore {
    nodes: HashMap<String, CredentialNode>,
    children: HashMap<String, Vec<String>>,
}

impl FlatStore {
    fn upsert_entry(&mut self, input: CredentialEntryInput) -> AppResult<CredentialEntryDto> {
        if let Some(existing_id) = extract_existing_id(&input) {
            if let Some(CredentialNode::Entry {
                id,
                parent_id,
                kind,
                name,
                fields,
                description,
                created_at,
                updated_at,
            }) = self.nodes.get_mut(&existing_id)
            {
                *name = input.name;
                *fields = input.fields;
                *description = input.description;
                *updated_at = Some(chrono::Utc::now().to_rfc3339());
                return Ok(CredentialEntryDto {
                    id: id.clone(),
                    parent_id: parent_id.clone(),
                    kind: kind.clone().to_string(),
                    name: name.clone(),
                    fields: fields.clone(),
                    description: description.clone(),
                    created_at: created_at.clone(),
                    updated_at: updated_at.clone(),
                });
            }
        }

        let target_parent = input.parent_id.unwrap_or_else(|| "root".to_string());
        if input.name.trim().is_empty() {
            return Err(AppError::validation("entry name is required"));
        }
        if !self.nodes.contains_key(&target_parent) {
            return Err(AppError::validation("parent folder not found"));
        }

        let kind = CredentialKind::from_str(&input.kind).unwrap_or(CredentialKind::Unknown);
        let id = uuid::Uuid::new_v4().to_string();
        let now = Some(chrono::Utc::now().to_rfc3339());
        let entry = CredentialNode::Entry {
            id: id.clone(),
            parent_id: Some(target_parent.clone()),
            kind: kind.clone(),
            name: input.name.clone(),
            fields: input.fields.clone(),
            description: input.description.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };

        self.nodes.insert(id.clone(), entry);
        self.children.entry(target_parent.clone()).or_default().push(id.clone());
        Ok(CredentialEntryDto {
            id,
            parent_id: Some(target_parent.clone()),
            kind: kind.clone().to_string(),
            name: input.name.clone(),
            fields: input.fields.clone(),
            description: input.description.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
        })
    }

    fn create_folder(&mut self, parent_id: Option<String>, name: String) -> AppResult<CredentialNodeRedacted> {
        if name.trim().is_empty() {
            return Err(AppError::validation("folder name is required"));
        }
        let target_parent = parent_id.unwrap_or_else(|| "root".to_string());
        if !self.nodes.contains_key(&target_parent) {
            return Err(AppError::validation("parent folder not found"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let trimmed = name.trim().to_string();
        let folder = CredentialNode::Folder {
            id: id.clone(),
            parent_id: Some(target_parent.clone()),
            name: trimmed.clone(),
            description: None,
            expanded: true,
            children: vec![],
        };
        self.nodes.insert(id.clone(), folder);
        self.children.entry(target_parent).or_default().push(id.clone());
        Ok(CredentialNodeRedacted::folder(id, trimmed))
    }

    fn move_node(&mut self, id: &str, target_parent: &str) -> AppResult<()> {
        if id == "root" {
            return Err(AppError::validation("cannot move root"));
        }
        if !self.nodes.contains_key(id) {
            return Err(AppError::validation("node not found"));
        }
        if !self.nodes.contains_key(target_parent) {
            return Err(AppError::validation("target folder not found"));
        }

        fn detach(children: &mut HashMap<String, Vec<String>>, target: &str) -> bool {
            children.values_mut().any(|list| {
                if let Some(pos) = list.iter().position(|x| x == target) {
                    list.remove(pos);
                    true
                } else {
                    false
                }
            })
        }

        detach(&mut self.children, id);

        if let Some(node) = self.nodes.get_mut(id) {
            match node {
                CredentialNode::Folder { parent_id, .. } => *parent_id = Some(target_parent.to_string()),
                CredentialNode::Entry { parent_id, .. } => *parent_id = Some(target_parent.to_string()),
            }
        }

        self.children.entry(target_parent.to_string()).or_default().push(id.to_string());
        Ok(())
    }

    fn copy_node(&mut self, id: &str, target_parent: &str) -> AppResult<CredentialNodeRedacted> {
        if id == "root" {
            return Err(AppError::validation("cannot copy root"));
        }
        let source = self.nodes.get(id).ok_or_else(|| AppError::validation("node not found"))?;
        let copy = match source {
            CredentialNode::Folder {
                id: _,
                parent_id: _,
                name,
                description,
                expanded,
                ..
            } => CredentialNode::Folder {
                id: uuid::Uuid::new_v4().to_string(),
                parent_id: Some(target_parent.to_string()),
                name: format!("{} (Copy)", name),
                description: description.clone(),
                expanded: *expanded,
                children: vec![],
            },
            CredentialNode::Entry {
                id: _,
                parent_id: _,
                kind,
                name,
                fields,
                description,
                created_at: _,
                updated_at: _,
            } => CredentialNode::Entry {
                id: uuid::Uuid::new_v4().to_string(),
                parent_id: Some(target_parent.to_string()),
                kind: kind.clone(),
                name: format!("{} (Copy)", name),
                fields: fields.clone(),
                description: description.clone(),
                created_at: Some(chrono::Utc::now().to_rfc3339()),
                updated_at: Some(chrono::Utc::now().to_rfc3339()),
            },
        };

        let copy_id = match &copy {
            CredentialNode::Folder { id, .. } => id.clone(),
            CredentialNode::Entry { id, .. } => id.clone(),
        };
        self.children.entry(target_parent.to_string()).or_default().push(copy_id.clone());
        self.nodes.insert(copy_id.clone(), copy.clone());

        Ok(match copy {
            CredentialNode::Folder { id, name, .. } => CredentialNodeRedacted::folder(id.clone(), name.clone()),
            CredentialNode::Entry { id, kind, name, description, .. } => {
                CredentialNodeRedacted::entry(id.clone(), kind.to_string(), name.clone(), description.clone())
            }
        })
    }


    fn rename_node(&mut self, id: &str, new_name: String) -> AppResult<CredentialNodeRedacted> {
        if id == "root" {
            return Err(AppError::validation("cannot rename root"));
        }
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::validation("name is required"));
        }
        let node = self.nodes.get_mut(id).ok_or_else(|| AppError::validation("node not found"))?;
        match node {
            CredentialNode::Folder { name, .. } => *name = trimmed.to_string(),
            CredentialNode::Entry { name, .. } => *name = trimmed.to_string(),
        }
        Ok(match node {
            CredentialNode::Folder { id, name, .. } => CredentialNodeRedacted::folder(id.clone(), name.clone()),
            CredentialNode::Entry { id, kind, name, description, .. } => {
                CredentialNodeRedacted::entry(id.clone(), kind.to_string(), name.clone(), description.clone())
            }
        })
    }

    fn delete_node(&mut self, id: &str) -> AppResult<()> {
        if id == "root" {
            return Err(AppError::validation("cannot delete root"));
        }
        let mut stack: Vec<String> = vec![id.to_string()];
        while let Some(current) = stack.pop() {
            if let Some(node) = self.nodes.get(current.as_str()) {
                if let CredentialNode::Folder { children, .. } = node {
                    for child in children {
                        if let CredentialNode::Folder { id, .. } = child {
                            stack.push(id.clone());
                        }
                    }
                }
            }
            self.nodes.remove(current.as_str());
        }

        self.children.values_mut().for_each(|list| {
            list.retain(|x| x != id);
        });
        Ok(())
    }

    fn redacted_tree(&self) -> Vec<CredentialNodeRedacted> {
        fn redact(nodes: &HashMap<String, CredentialNode>, children: &HashMap<String, Vec<String>>, id: &str) -> Vec<CredentialNodeRedacted> {
            let mut out = vec![];
            if let Some(ids) = children.get(id) {
                for child_id in ids {
                    if let Some(node) = nodes.get(child_id) {
                        match node {
                            CredentialNode::Folder { id, name, .. } => {
                                let mut dto = CredentialNodeRedacted::folder(id.clone(), name.clone());
                                dto.children = Some(redact(nodes, children, id));
                                out.push(dto);
                            }
                            CredentialNode::Entry { id, kind, name, description, .. } => {
                                out.push(CredentialNodeRedacted::entry(id.clone(), kind.to_string(), name.clone(), description.clone()));
                            }
                        }
                    }
                }
            }
            out
        }

        redact(&self.nodes, &self.children, "root")
    }

    fn full_entry_dto(&self, id: &str) -> AppResult<CredentialEntryDto> {
        let node = self.nodes.get(id).ok_or_else(|| AppError::validation("entry not found"))?;
        match node {
            CredentialNode::Entry {
                id,
                parent_id,
                kind,
                name,
                fields,
                description,
                created_at,
                updated_at,
            } => Ok(CredentialEntryDto {
                id: id.clone(),
                parent_id: parent_id.clone(),
                kind: kind.clone().to_string(),
                name: name.clone(),
                fields: fields.clone(),
                description: description.clone(),
                created_at: created_at.clone(),
                updated_at: updated_at.clone(),
            }),
            _ => Err(AppError::validation("node is not an entry")),
        }
    }

    fn to_persisted(&self) -> Vec<PersistedNode> {
        let mut out = vec![];
        fn collect(nodes: &HashMap<String, CredentialNode>, children: &HashMap<String, Vec<String>>, id: &str, out: &mut Vec<PersistedNode>) {
            if let Some(ids) = children.get(id) {
                for child_id in ids {
                    if let Some(node) = nodes.get(child_id) {
                        match node {
                            CredentialNode::Folder { id, parent_id, name, description, expanded, children: _ } => {
                                let mut folder = PersistedNode::folder(id.clone(), parent_id.clone(), name.clone());
                                folder.description = description.clone();
                                folder.expanded = *expanded;
                                collect(nodes, children, id, &mut folder.children);
                                out.push(folder);
                            }
                            CredentialNode::Entry { id, parent_id, kind, name, fields, description, created_at, updated_at } => {
                                out.push(PersistedNode::entry(id.clone(), parent_id.clone(), kind.clone(), name.clone(), fields.clone(), description.clone(), created_at.clone(), updated_at.clone()));
                            }
                        }
                    }
                }
            }
        }
        collect(&self.nodes, &self.children, "root", &mut out);
        out
    }
}

// ------------------------------------------------------------ - 凭据服务

#[derive(Debug, Clone)]
pub struct CredentialService {
    store: Arc<RwLock<FlatStore>>,
}

impl Default for CredentialService {
    fn default() -> Self {
        let mut store = FlatStore::default();
        store.nodes.insert(
            "root".to_string(),
            CredentialNode::Folder {
                id: "root".to_string(),
                parent_id: None,
                name: "Vault".to_string(),
                description: Some("Root of the local encrypted vault".to_string()),
                expanded: true,
                children: vec![],
            },
        );
        Self {
            store: Arc::new(RwLock::new(store)),
        }
    }
}

impl CredentialService {
    pub async fn new() -> AppResult<Self> {
        let service = Self::default();
        service.load().await?;
        Ok(service)
    }

    pub async fn load(&self) -> AppResult<()> {
        let path = data_file_path(CREDENTIALS_FILE)?;
        if !path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(&path)?;
        let nodes: Vec<PersistedNode> = match try_decrypt(&bytes) {
            Ok(nodes) => nodes,
            Err(_) => serde_json::from_slice(&bytes).map_err(|e| AppError::io(e.to_string()))?,
        };

        let mut store = self.store.write().await;
        store.nodes.clear();
        store.children.clear();
        store.nodes.insert(
            "root".to_string(),
            CredentialNode::Folder {
                id: "root".to_string(),
                parent_id: None,
                name: "Vault".to_string(),
                description: Some("Root of the local encrypted vault".to_string()),
                expanded: true,
                children: vec![],
            },
        );

        for node in nodes {
            match node.node_type.as_str() {
                "folder" => {
                    store.nodes.insert(node.id.clone(), CredentialNode::Folder {
                        id: node.id.clone(),
                        parent_id: node.parent_id.clone(),
                        name: node.name.clone(),
                        description: node.description.clone(),
                        expanded: node.expanded,
                        children: vec![],
                    });
                    store.children.entry(node.parent_id.unwrap_or_else(|| "root".to_string())).or_default().push(node.id);
                }
                "entry" => {
                    let kind = CredentialKind::from_str(node.kind.as_deref().unwrap_or("unknown")).unwrap_or(CredentialKind::Unknown);
                    store.nodes.insert(node.id.clone(), CredentialNode::Entry {
                        id: node.id.clone(),
                        parent_id: node.parent_id.clone(),
                        kind,
                        name: node.name.clone(),
                        fields: node.fields.unwrap_or_default(),
                        description: node.description.clone(),
                        created_at: node.created_at.clone(),
                        updated_at: node.updated_at.clone(),
                    });
                    store.children.entry(node.parent_id.unwrap_or_else(|| "root".to_string())).or_default().push(node.id);
                }
                _ => {}
            }
        }

        Ok(())
    }

    async fn persist(&self) -> AppResult<()> {
        let store = self.store.read().await;
        let nodes = store.to_persisted();
        let body = serde_json::to_vec(&nodes)?;
        let encrypted = encrypt_password(&String::from_utf8(body)?)?;
        let path = data_file_path(CREDENTIALS_FILE)?;
        atomic_write(path, encrypted.into_bytes())?;
        Ok(())
    }

    pub async fn redacted_tree(&self) -> AppResult<Vec<CredentialNodeRedacted>> {
        let store = self.store.read().await;
        Ok(store.redacted_tree())
    }

    pub async fn full_entry(&self, id: &str) -> AppResult<CredentialEntryDto> {
        let store = self.store.read().await;
        store.full_entry_dto(id)
    }

    pub async fn upsert_entry(&self, input: CredentialEntryInput) -> AppResult<CredentialEntryDto> {
        if let Some(password) = input.fields.password.as_ref() {
            if !password.is_empty() && !password.starts_with("wkgrd:") {
                let encrypted = encrypt_password(password)?;
                let mut fields = input.fields.clone();
                fields.password = Some(encrypted);
                let input = CredentialEntryInput {
                    parent_id: input.parent_id.clone(),
                    kind: input.kind.clone(),
                    name: input.name.clone(),
                    fields,
                    description: input.description.clone(),
                };
                let mut store = self.store.write().await;
                let out = store.upsert_entry(input)?;
                drop(store);
                self.persist().await?;
                return Ok(out);
            }
        }

        let mut store = self.store.write().await;
        let out = store.upsert_entry(input)?;
        drop(store);
        self.persist().await?;
        Ok(out)
    }

    pub async fn create_folder(&self, parent_id: Option<String>, name: String) -> AppResult<CredentialNodeRedacted> {
        let mut store = self.store.write().await;
        let out = store.create_folder(parent_id, name)?;
        drop(store);
        self.persist().await?;
        Ok(out)
    }

    pub async fn move_node(&self, id: &str, target_parent: &str) -> AppResult<()> {
        let mut store = self.store.write().await;
        store.move_node(id, target_parent)?;
        drop(store);
        self.persist().await?;
        Ok(())
    }

    pub async fn copy_node(&self, id: &str, target_parent: &str) -> AppResult<CredentialNodeRedacted> {
        let mut store = self.store.write().await;
        let out = store.copy_node(id, target_parent)?;
        drop(store);
        self.persist().await?;
        Ok(out)
    }


    pub async fn rename_node(&self, id: &str, new_name: String) -> AppResult<CredentialNodeRedacted> {
        let mut store = self.store.write().await;
        let out = store.rename_node(id, new_name)?;
        drop(store);
        self.persist().await?;
        Ok(out)
    }

    pub async fn delete_node(&self, id: &str) -> AppResult<()> {
        let mut store = self.store.write().await;
        store.delete_node(id)?;
        drop(store);
        self.persist().await?;
        Ok(())
    }
}

fn atomic_write(path: std::path::PathBuf, bytes: Vec<u8>) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn try_decrypt(bytes: &[u8]) -> AppResult<Vec<PersistedNode>> {
    let text = String::from_utf8(bytes.to_vec()).map_err(|e| AppError::io(e.to_string()))?;
    let plain = decrypt_password(&text)?;
    let nodes: Vec<PersistedNode> = serde_json::from_str(&plain).map_err(|e| AppError::io(e.to_string()))?;
    Ok(nodes)
}

fn extract_existing_id(input: &CredentialEntryInput) -> Option<String> {
    fn walk(value: &serde_json::Value) -> Option<String> {
        let map = value.as_object()?;
        if let Some(v) = map.get("id") {
            if let Some(id) = v.as_str() {
                if !id.is_empty() && id != "new" {
                    return Some(id.to_string());
                }
            }
        }
        for v in map.values() {
            if let Some(id) = walk(v) {
                return Some(id);
            }
        }
        None
    }
    let value = serde_json::to_value(input).ok()?;
    walk(&value)
}

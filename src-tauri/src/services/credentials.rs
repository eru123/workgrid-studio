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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<CredentialNodeRedacted>>,
    /// Folders only: UI expansion state, persisted with the vault.
    #[serde(default)]
    pub expanded: bool,
}

impl CredentialNodeRedacted {
    fn folder(id: String, parent_id: Option<String>, name: String, expanded: bool) -> Self {
        Self {
            id,
            node_type: "folder".to_string(),
            name,
            description: None,
            kind: None,
            parent_id,
            children: Some(vec![]),
            expanded,
        }
    }

    fn entry(id: String, parent_id: Option<String>, kind: String, name: String, description: Option<String>) -> Self {
        Self {
            id,
            node_type: "entry".to_string(),
            name,
            description,
            kind: Some(kind),
            parent_id,
            children: Some(vec![]),
            expanded: false,
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
        let existing_id = input
            .id
            .as_deref()
            .filter(|id| !id.is_empty() && *id != "new")
            .map(str::to_string);
        if let Some(existing_id) = existing_id {
            match self.nodes.get_mut(&existing_id) {
                Some(CredentialNode::Entry {
                    id,
                    parent_id,
                    kind,
                    name,
                    fields,
                    description,
                    created_at,
                    updated_at,
                }) => {
                    if input.name.trim().is_empty() {
                        return Err(AppError::validation("entry name is required"));
                    }
                    // The vault is SSH-identity scoped; empty or legacy kind
                    // strings default to `ssh` rather than degrading to Unknown.
                    *kind = CredentialKind::from_str(&input.kind).unwrap_or(CredentialKind::Ssh);
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
                Some(CredentialNode::Folder { .. }) => {
                    return Err(AppError::validation("id refers to a folder, not an entry"));
                }
                None => return Err(AppError::validation("entry not found")),
            }
        }

        let target_parent = input.parent_id.unwrap_or_else(|| "root".to_string());
        if input.name.trim().is_empty() {
            return Err(AppError::validation("entry name is required"));
        }
        if !self.nodes.contains_key(&target_parent) {
            return Err(AppError::validation("parent folder not found"));
        }

        let kind = CredentialKind::from_str(&input.kind).unwrap_or(CredentialKind::Ssh);
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
        self.children.entry(target_parent.clone()).or_default().push(id.clone());
        let parent_id = if target_parent == "root" { None } else { Some(target_parent.clone()) };
        Ok(CredentialNodeRedacted::folder(id, parent_id, trimmed, true))
    }

    /// Set a folder's UI expansion state (persisted with the vault so the
    /// tree reopens where the user left it).
    fn set_expanded(&mut self, id: &str, expanded: bool) -> AppResult<()> {
        match self.nodes.get_mut(id) {
            Some(CredentialNode::Folder { expanded: slot, .. }) => {
                *slot = expanded;
                Ok(())
            }
            Some(CredentialNode::Entry { .. }) => Err(AppError::validation("node is not a folder")),
            None => Err(AppError::validation("node not found")),
        }
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
        // Cycle guard: refuse to move a folder into itself or any of its
        // descendants (would orphan the moved subtree).
        if id == target_parent || self.is_descendant(target_parent, id) {
            return Err(AppError::validation("cannot move a folder into itself or its descendant"));
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

    /// Reorder (and optionally reparent) a node under `target_parent`,
    /// inserting it before `before_id` when supplied, or appending to the end.
    /// `before_id: None` means append at the end. Validates the target parent
    /// exists, the node is not root, and `before_id` is a direct child of the
    /// target parent when given.
    fn reorder_node(&mut self, id: &str, target_parent: &str, before_id: Option<&str>) -> AppResult<()> {
        if id == "root" {
            return Err(AppError::validation("cannot reorder root"));
        }
        if !self.nodes.contains_key(id) {
            return Err(AppError::validation("node not found"));
        }
        if !self.nodes.contains_key(target_parent) {
            return Err(AppError::validation("target folder not found"));
        }
        if id == target_parent || self.is_descendant(target_parent, id) {
            return Err(AppError::validation("cannot move a folder into itself or its descendant"));
        }
        if let Some(before) = before_id {
            let is_child = self.children.get(target_parent)
                .map(|list| list.iter().any(|x| x == before))
                .unwrap_or(false);
            if !is_child {
                return Err(AppError::validation("before_id is not a child of the target parent"));
            }
        }

        // Detach from current parent (or its current slot).
        if let Some(list) = self.children.values_mut().find(|list| list.iter().any(|x| *x == id)) {
            list.retain(|x| x != id);
        }

        if let Some(node) = self.nodes.get_mut(id) {
            match node {
                CredentialNode::Folder { parent_id, .. } => *parent_id = Some(target_parent.to_string()),
                CredentialNode::Entry { parent_id, .. } => *parent_id = Some(target_parent.to_string()),
            }
        }

        let list = self.children.entry(target_parent.to_string()).or_default();
        match before_id {
            Some(before) => {
                if let Some(pos) = list.iter().position(|x| x == before) {
                    list.insert(pos, id.to_string());
                } else {
                    list.push(id.to_string());
                }
            }
            None => list.push(id.to_string()),
        }
        Ok(())
    }

    /// True when `candidate` is a descendant of `ancestor` (transitive).
    fn is_descendant(&self, candidate: &str, ancestor: &str) -> bool {
        let mut stack = vec![ancestor.to_string()];
        while let Some(current) = stack.pop() {
            if let Some(child_ids) = self.children.get(&current) {
                for child_id in child_ids {
                    if child_id == candidate {
                        return true;
                    }
                    stack.push(child_id.clone());
                }
            }
        }
        false
    }

    fn copy_node(&mut self, id: &str, target_parent: &str) -> AppResult<CredentialNodeRedacted> {
        if id == "root" {
            return Err(AppError::validation("cannot copy root"));
        }
        if !self.nodes.contains_key(id) {
            return Err(AppError::validation("node not found"));
        }
        if !self.nodes.contains_key(target_parent) {
            return Err(AppError::validation("target folder not found"));
        }
        let copy_id = self.copy_subtree(id, target_parent)?;

        // VS Code-style duplicate naming on the top-level copy only. Entries
        // keep `.store` trailing — "hello.store" → "hello (Copy).store" — so
        // the explorer (which hides the suffix) shows "hello (Copy)".
        if let Some(node) = self.nodes.get_mut(&copy_id) {
            match node {
                CredentialNode::Folder { name, .. } => *name = format!("{} (Copy)", name),
                CredentialNode::Entry { name, .. } => *name = duplicated_entry_name(name),
            }
        }

        self.redacted_node(&copy_id)
            .ok_or_else(|| AppError::validation("copy failed"))
    }

    /// Deep-copy `source_id` (and its whole subtree) under `new_parent`,
    /// returning the new top-level id. Fresh ids throughout, so no cycles.
    fn copy_subtree(&mut self, source_id: &str, new_parent: &str) -> AppResult<String> {
        let source = self
            .nodes
            .get(source_id)
            .cloned()
            .ok_or_else(|| AppError::validation("node not found"))?;
        let new_id = uuid::Uuid::new_v4().to_string();
        match source {
            CredentialNode::Folder { name, description, expanded, .. } => {
                self.nodes.insert(
                    new_id.clone(),
                    CredentialNode::Folder {
                        id: new_id.clone(),
                        parent_id: Some(new_parent.to_string()),
                        name,
                        description,
                        expanded,
                        children: vec![],
                    },
                );
                self.children.entry(new_parent.to_string()).or_default().push(new_id.clone());
                let child_ids = self.children.get(source_id).cloned().unwrap_or_default();
                for child_id in child_ids {
                    self.copy_subtree(&child_id, &new_id)?;
                }
            }
            CredentialNode::Entry { kind, name, fields, description, .. } => {
                let now = Some(chrono::Utc::now().to_rfc3339());
                self.nodes.insert(
                    new_id.clone(),
                    CredentialNode::Entry {
                        id: new_id.clone(),
                        parent_id: Some(new_parent.to_string()),
                        kind,
                        name,
                        fields,
                        description,
                        created_at: now.clone(),
                        updated_at: now,
                    },
                );
                self.children.entry(new_parent.to_string()).or_default().push(new_id.clone());
            }
        }
        Ok(new_id)
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
            CredentialNode::Folder { id, parent_id, name, expanded, .. } => {
                let pid = parent_id.as_ref().filter(|p| p.as_str() != "root").cloned();
                CredentialNodeRedacted::folder(id.clone(), pid, name.clone(), *expanded)
            }
            CredentialNode::Entry { id, parent_id, kind, name, description, .. } => {
                let pid = parent_id.as_ref().filter(|p| p.as_str() != "root").cloned();
                CredentialNodeRedacted::entry(id.clone(), pid, kind.to_string(), name.clone(), description.clone())
            }
        })
    }

    fn delete_node(&mut self, id: &str) -> AppResult<()> {
        if id == "root" {
            return Err(AppError::validation("cannot delete root"));
        }
        if !self.nodes.contains_key(id) {
            return Err(AppError::validation("node not found"));
        }
        // Depth-first removal via the flat children map. The previous impl
        // recursed through CredentialNode::Folder.children, which is unused in
        // the flat store, so subfolders were never deleted.
        let mut stack: Vec<String> = vec![id.to_string()];
        while let Some(current) = stack.pop() {
            if let Some(child_ids) = self.children.get(&current).cloned() {
                for child_id in child_ids {
                    stack.push(child_id);
                }
            }
            self.children.remove(&current);
            self.nodes.remove(&current);
        }
        // Detach the top-level id from any remaining children lists.
        self.children.values_mut().for_each(|list| {
            list.retain(|x| x != id);
        });
        Ok(())
    }

    fn redacted_tree(&self) -> Vec<CredentialNodeRedacted> {
        self.redacted_children("root")
    }

    /// Redacted DTOs for the direct children of `parent_id` (recursive for
    /// folders). Secrets never appear here — fields are not serialized.
    fn redacted_children(&self, parent_id: &str) -> Vec<CredentialNodeRedacted> {
        let mut out = vec![];
        if let Some(ids) = self.children.get(parent_id) {
            for child_id in ids {
                if let Some(dto) = self.redacted_node(child_id) {
                    out.push(dto);
                }
            }
        }
        out
    }

    fn redacted_node(&self, id: &str) -> Option<CredentialNodeRedacted> {
        let node = self.nodes.get(id)?;
        // Roots (direct children of "root") report no parent so the frontend
        // can place them at the top level.
        let parent_id = match node {
            CredentialNode::Folder { parent_id, .. } | CredentialNode::Entry { parent_id, .. } => {
                parent_id.as_ref().filter(|p| p.as_str() != "root").cloned()
            }
        };
        Some(match node {
            CredentialNode::Folder { id, name, expanded, .. } => {
                let mut dto = CredentialNodeRedacted::folder(id.clone(), parent_id, name.clone(), *expanded);
                dto.children = Some(self.redacted_children(id));
                dto
            }
            CredentialNode::Entry { id, kind, name, description, .. } => {
                CredentialNodeRedacted::entry(id.clone(), parent_id, kind.to_string(), name.clone(), description.clone())
            }
        })
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

        // Recurse: persisted nodes nest children inside their folder entries,
        // so a flat top-level pass would drop every nested node.
        fn insert_persisted(store: &mut FlatStore, node: PersistedNode) {
            let parent = node.parent_id.clone().unwrap_or_else(|| "root".to_string());
            match node.node_type.as_str() {
                "folder" => {
                    let PersistedNode {
                        id,
                        parent_id,
                        name,
                        description,
                        expanded,
                        children,
                        ..
                    } = node;
                    store.nodes.insert(
                        id.clone(),
                        CredentialNode::Folder {
                            id: id.clone(),
                            parent_id,
                            name,
                            description,
                            expanded,
                            children: vec![],
                        },
                    );
                    store.children.entry(parent).or_default().push(id.clone());
                    for child in children {
                        insert_persisted(store, child);
                    }
                }
                "entry" => {
                    let kind = CredentialKind::from_str(node.kind.as_deref().unwrap_or("unknown"))
                        .unwrap_or(CredentialKind::Unknown);
                    store.nodes.insert(
                        node.id.clone(),
                        CredentialNode::Entry {
                            id: node.id.clone(),
                            parent_id: node.parent_id.clone(),
                            kind,
                            name: node.name,
                            fields: node.fields.unwrap_or_default(),
                            description: node.description,
                            created_at: node.created_at,
                            updated_at: node.updated_at,
                        },
                    );
                    store.children.entry(parent).or_default().push(node.id);
                }
                _ => {}
            }
        }

        for node in nodes {
            insert_persisted(&mut store, node);
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
        let mut dto = store.full_entry_dto(id)?;
        drop(store);
        // The editor sends fields back verbatim on save; hand it plaintext so
        // the form never displays `wkgrd:` ciphertext. Sealing on the next
        // upsert skips values that already carry the prefix, so this is stable.
        unseal_secret_fields(&mut dto.fields)?;
        Ok(dto)
    }

    pub async fn upsert_entry(&self, input: CredentialEntryInput) -> AppResult<CredentialEntryDto> {
        // Seal secret fields (SSH password, key contents, key passphrase)
        // before anything touches the store; already-sealed values pass through.
        let mut sealed = input.clone();
        seal_secret_fields(&mut sealed.fields)?;

        let mut store = self.store.write().await;
        let out = store.upsert_entry(sealed)?;
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

    /// Reorder a node under `target_parent`, inserting before `before_id`
    /// (when `Some`) or appending at the end (when `None`).
    pub async fn reorder_node(&self, id: &str, target_parent: &str, before_id: Option<&str>) -> AppResult<()> {
        let mut store = self.store.write().await;
        store.reorder_node(id, target_parent, before_id)?;
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

    pub async fn set_expanded(&self, id: &str, expanded: bool) -> AppResult<()> {
        let mut store = self.store.write().await;
        store.set_expanded(id, expanded)?;
        drop(store);
        self.persist().await?;
        Ok(())
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

/// `hello.store` → `hello (Copy).store` (suffix stays trailing so the UI's
/// `.store`-hiding display strips it). Non-`.store` names get a plain
/// ` (Copy)` appended.
fn duplicated_entry_name(name: &str) -> String {
    const SUFFIX: &str = ".store";
    match name.strip_suffix(SUFFIX) {
        Some(stem) => format!("{stem} (Copy){SUFFIX}"),
        None => format!("{name} (Copy)"),
    }
}

fn try_decrypt(bytes: &[u8]) -> AppResult<Vec<PersistedNode>> {
    let text = String::from_utf8(bytes.to_vec()).map_err(|e| AppError::io(e.to_string()))?;
    let plain = decrypt_password(&text)?;
    let nodes: Vec<PersistedNode> = serde_json::from_str(&plain).map_err(|e| AppError::io(e.to_string()))?;
    Ok(nodes)
}

/// Encrypt-in-place every secret field (SSH user password, private key
/// contents, key passphrase). Values already carrying the `wkgrd:` prefix
/// and empty values pass through untouched. Plaintext leaks past this only
/// via the whole-file envelope, which is itself AES-256-GCM encrypted.
fn seal_secret_fields(fields: &mut CredentialFields) -> AppResult<()> {
    let CredentialFields {
        password,
        private_key,
        passphrase,
        ..
    } = fields;
    for secret in [password, private_key, passphrase] {
        if let Some(value) = secret.as_ref() {
            if !value.is_empty() && !value.starts_with("wkgrd:") {
                *secret = Some(encrypt_password(value)?);
            }
        }
    }
    Ok(())
}

/// Decrypt-in-place the sealed fields produced by `seal_secret_fields`.
/// Non-`wkgrd:` values pass through `decrypt_password` unchanged.
fn unseal_secret_fields(fields: &mut CredentialFields) -> AppResult<()> {
    let CredentialFields {
        password,
        private_key,
        passphrase,
        ..
    } = fields;
    for secret in [password, private_key, passphrase] {
        if let Some(value) = secret.as_ref() {
            if !value.is_empty() {
                *secret = Some(decrypt_password(value)?);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: Option<String>, parent_id: Option<String>, kind: &str, name: &str, secret: &str) -> CredentialEntryInput {
        CredentialEntryInput {
            id,
            parent_id,
            kind: kind.to_string(),
            name: name.to_string(),
            fields: CredentialFields {
                user: Some("root".to_string()),
                password: Some("hunter2".to_string()),
                private_key: Some("-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----".to_string()),
                private_key_path: Some("~/.ssh/id_ed25519".to_string()),
                passphrase: Some(secret.to_string()),
                ..Default::default()
            },
            description: None,
        }
    }

    // Redirect HOME for the whole test so persistence lands in a sandbox.
    // Both tests mutate the environment, so they serialize on this lock
    // (cargo test runs them in parallel otherwise).
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TempHome {
        dir: std::path::PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }
    impl TempHome {
        fn new() -> Self {
            let guard = HOME_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            let dir = std::env::temp_dir().join(format!("workgrid-vault-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            std::env::set_var("HOME", &dir);
            Self { dir, _guard: guard }
        }
    }
    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[tokio::test]
    async fn vault_round_trip_update_in_place_and_decrypt() {
        let _home = TempHome::new();

        // Create a folder + entry, which persists credentials.json.
        let service = CredentialService::default();
        let folder = service.create_folder(None, "Work".to_string()).await.unwrap();
        let created = service
            .upsert_entry(input(None, Some(folder.id.clone()), "ssh", "Prod bastion.store", "s3cret"))
            .await
            .unwrap();

        // "Restart": a fresh service loads the persisted vault.
        let reloaded = CredentialService::new().await.unwrap();
        let tree = reloaded.redacted_tree().await.unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "Work");
        assert_eq!(tree[0].children.as_ref().unwrap().len(), 1);

        // Update with the existing id updates in place (no duplicate).
        let updated = reloaded
            .upsert_entry(input(Some(created.id.clone()), Some(folder.id.clone()), "ssh", "Prod bastion.store", "n3wpass"))
            .await
            .unwrap();
        assert_eq!(updated.id, created.id);
        let tree = reloaded.redacted_tree().await.unwrap();
        assert_eq!(tree[0].children.as_ref().unwrap().len(), 1);

        // full_entry unseals every secret and reflects the new values.
        let full = reloaded.full_entry(&created.id).await.unwrap();
        assert_eq!(full.kind, "ssh");
        assert_eq!(full.fields.user.as_deref(), Some("root"));
        assert_eq!(full.fields.password.as_deref(), Some("hunter2"));
        assert_eq!(
            full.fields.private_key.as_deref(),
            Some("-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----")
        );
        assert_eq!(full.fields.private_key_path.as_deref(), Some("~/.ssh/id_ed25519"));
        assert_eq!(full.fields.passphrase.as_deref(), Some("n3wpass"));

        // The file on disk is encrypted and contains no plaintext secrets:
        // not the user password, key body, or passphrase.
        let bytes = std::fs::read(data_file_path(CREDENTIALS_FILE).unwrap()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("wkgrd:"));
        assert!(!text.contains("s3cret"));
        assert!(!text.contains("n3wpass"));
        assert!(!text.contains("hunter2"));
        assert!(!text.contains("BEGIN OPENSSH PRIVATE KEY"));
        assert!(!text.contains("abc123"));

        // A stale id is an error, not a silent duplicate.
        let stale = reloaded
            .upsert_entry(input(Some("no-such-id".to_string()), None, "login", "Ghost.store", "x"))
            .await;
        assert!(stale.is_err());
    }

    #[tokio::test]
    async fn folder_ops_keep_tree_consistent() {
        let _home = TempHome::new();
        let service = CredentialService::default();

        let a = service.create_folder(None, "A".to_string()).await.unwrap();
        let b = service.create_folder(None, "B".to_string()).await.unwrap();
        let entry = service
            .upsert_entry(input(None, Some(a.id.clone()), "ssh", "e.store", "pw"))
            .await
            .unwrap();

        // Move entry A's child? Move the entry into B.
        service.move_node(&entry.id, &b.id).await.unwrap();
        let tree = service.redacted_tree().await.unwrap();
        let folder_a = tree.iter().find(|n| n.name == "A").unwrap();
        assert!(folder_a.children.as_ref().unwrap().is_empty());
        let folder_b = tree.iter().find(|n| n.name == "B").unwrap();
        assert_eq!(folder_b.children.as_ref().unwrap().len(), 1);

        // Copy folder B (with child) into A — subtree copy keeps the original.
        service.copy_node(&b.id, &a.id).await.unwrap();
        let tree = service.redacted_tree().await.unwrap();
        let folder_a = tree.iter().find(|n| n.name == "A").unwrap();
        let copied = folder_a.children.as_ref().unwrap().first().unwrap();
        assert_eq!(copied.name, "B (Copy)");
        assert_eq!(copied.children.as_ref().unwrap().len(), 1);

        // Deleting folder A removes the copied subtree entirely.
        service.delete_node(&a.id).await.unwrap();
        let tree = service.redacted_tree().await.unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "B");

        // Renaming an entry round-trips.
        service.rename_node(&entry.id, "renamed.store".to_string()).await.unwrap();
        let tree = service.redacted_tree().await.unwrap();
        assert_eq!(tree[0].children.as_ref().unwrap()[0].name, "renamed.store");

        // Duplicating an entry keeps `.store` trailing so the UI hides it:
        // "renamed.store" → "renamed (Copy).store".
        let copy = service.copy_node(&entry.id, "root").await.unwrap();
        assert_eq!(copy.name, "renamed (Copy).store");
        let tree = service.redacted_tree().await.unwrap();
        assert!(tree.iter().any(|n| n.name == "renamed (Copy).store"));
    }

    #[tokio::test]
    async fn folder_expansion_persists() {
        let _home = TempHome::new();
        let service = CredentialService::default();

        let outer = service.create_folder(None, "Outer".to_string()).await.unwrap();
        let inner = service.create_folder(Some(outer.id.clone()), "Inner".to_string()).await.unwrap();
        assert!(outer.expanded, "new folders default to expanded");

        service.set_expanded(&outer.id, false).await.unwrap();
        service.set_expanded(&inner.id, true).await.unwrap();

        // Expansion state survives a restart.
        let reloaded = CredentialService::new().await.unwrap();
        let tree = reloaded.redacted_tree().await.unwrap();
        let outer_dto = &tree[0];
        assert!(!outer_dto.expanded);
        let inner_dto = &outer_dto.children.as_ref().unwrap()[0];
        assert!(inner_dto.expanded);

        // Root is a folder, so it is accepted.
        assert!(reloaded.set_expanded("root", true).await.is_ok());
    }
}

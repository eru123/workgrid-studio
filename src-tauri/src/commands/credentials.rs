// Credential commands: thin handlers over `CredentialService`.
// Secrets are never returned from tree paths; full entry fetches are
// required to read credential fields.

use tauri::State;

use crate::services::credentials::{CredentialNodeRedacted, CredentialService};
use crate::{AppResult, models::CredentialEntryInput};

/// Get a redacted credential tree.
#[tauri::command]
pub async fn credentials_get_tree(
    store: State<'_, CredentialService>,
) -> AppResult<Vec<CredentialNodeRedacted>> {
    store.redacted_tree().await
}

/// Get a full credential entry by id.
#[tauri::command]
pub async fn credentials_get_entry(store: State<'_, CredentialService>, id: String) -> AppResult<crate::models::CredentialEntryDto> {
    store.full_entry(&id).await
}

/// Create or update a credential entry. Passwords are encrypted before
/// persistence. When an existing id is supplied the entry is updated in-place.
#[tauri::command]
pub async fn credentials_upsert_entry(
    store: State<'_, CredentialService>,
    input: CredentialEntryInput,
) -> AppResult<crate::models::CredentialEntryDto> {
    store.upsert_entry(input).await
}

/// Create a folder under an optional parent. Defaults to root when omitted.
#[tauri::command]
pub async fn credentials_create_folder(
    store: State<'_, CredentialService>,
    parent_id: Option<String>,
    name: String,
) -> AppResult<CredentialNodeRedacted> {
    store.create_folder(parent_id, name).await
}

/// Move a node to a new parent folder.
#[tauri::command]
pub async fn credentials_move_node(
    store: State<'_, CredentialService>,
    id: String,
    target_parent: String,
) -> AppResult<()> {
    store.move_node(&id, &target_parent).await
}

/// Copy a node to a new parent folder.
#[tauri::command]
pub async fn credentials_copy_node(
    store: State<'_, CredentialService>,
    id: String,
    target_parent: String,
) -> AppResult<CredentialNodeRedacted> {
    store.copy_node(&id, &target_parent).await
}


/// Rename a node by id.
#[tauri::command]
pub async fn credentials_rename_node(
    store: State<'_, CredentialService>,
    id: String,
    new_name: String,
) -> AppResult<CredentialNodeRedacted> {
    store.rename_node(&id, new_name).await
}

/// Delete a node by id.
#[tauri::command]
pub async fn credentials_delete_node(
    store: State<'_, CredentialService>,
    id: String,
) -> AppResult<()> {
    store.delete_node(&id).await
}

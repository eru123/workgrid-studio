// Tree commands — map schema introspection into TreeNode shapes for the
// explorer's TreeBackend. The tree hierarchy is:
//   root: databases (children of the profile)
//   database → tables (children)
//   table → columns (children, non-collapsible leaves)
//
// Node ids encode the path so `tree_get_children` can resolve them:
//   "db:<dbname>"          — a database
//   "table:<dbname>:<tbl>" — a table
//   "column:..."           — a column (leaf)

use serde_json::json;
use tauri::State;

use crate::models::TreeNode;
use crate::services::connection::ConnectionManager;
use crate::AppResult;

/// Get root tree nodes for a profile — returns the list of databases.
#[tauri::command]
pub async fn tree_get_roots(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
) -> AppResult<Vec<TreeNode>> {
    // We need the driver to call list_databases, which requires a session.
    let session_id = cm.begin_session(&profile_id).await?;
    let databases = {
        let drivers = cm.get_driver(&profile_id).await?;
        let driver = drivers.get(&profile_id).ok_or_else(|| {
            crate::AppError::state(format!("No connection for profile {}", profile_id))
        })?;
        driver.list_databases(&session_id).await?
    };
    let _ = cm.end_session(&session_id).await;

    let nodes: Vec<TreeNode> = databases
        .into_iter()
        .map(|db| TreeNode {
            id: format!("db:{}", db),
            label: db,
            icon: Some("database".to_string()),
            collapsible: Some(true),
            data: Some(json!({ "kind": "database" })),
            ..Default::default()
        })
        .collect();
    Ok(nodes)
}

/// Get children of a tree node by id.
#[tauri::command]
pub async fn tree_get_children(
    cm: State<'_, ConnectionManager>,
    profile_id: String,
    node_id: String,
) -> AppResult<Vec<TreeNode>> {
    let (kind, rest) = node_id.split_once(':').unwrap_or(("root", ""));

    let session_id = cm.begin_session(&profile_id).await?;
    let drivers = cm.get_driver(&profile_id).await?;
    let driver = drivers.get(&profile_id).ok_or_else(|| {
        crate::AppError::state(format!("No connection for profile {}", profile_id))
    })?;

    let children: Vec<TreeNode> = match kind {
        "root" | "" => {
            // Top-level: list databases.
            let dbs = driver.list_databases(&session_id).await?;
            dbs.into_iter()
                .map(|db| TreeNode {
                    id: format!("db:{}", db),
                    label: db,
                    icon: Some("database".to_string()),
                    collapsible: Some(true),
                    data: Some(json!({ "kind": "database" })),
                    ..Default::default()
                })
                .collect()
        }
        "db" => {
            // Database → tables.
            let db = rest;
            let tables = driver.list_tables(&session_id, db).await?;
            tables
                .into_iter()
                .map(|tbl| {
                    let id = format!("table:{}:{}", db, tbl);
                    let data = json!({ "kind": "table", "database": db, "table": &tbl });
                    TreeNode {
                        id,
                        label: tbl,
                        icon: Some("table".to_string()),
                        collapsible: Some(true),
                        data: Some(data),
                        ..Default::default()
                    }
                })
                .collect()
        }
        "table" => {
            // table:<db>:<tbl> → columns.
            let parts: Vec<&str> = rest.splitn(2, ':').collect();
            if parts.len() < 2 {
                return Ok(vec![]);
            }
            let (db, tbl) = (parts[0], parts[1]);
            let columns = driver.list_columns(&session_id, db, tbl).await?;
            columns
                .into_iter()
                .map(|col| {
                    let id = format!("column:{}:{}:{}", db, tbl, col.name);
                    let data = json!({
                        "kind": "column",
                        "database": db,
                        "table": tbl,
                        "name": &col.name,
                        "type": &col.col_type,
                        "nullable": col.nullable,
                        "key": &col.key,
                    });
                    let icon = if col.key == "PRI" {
                        "key".to_string()
                    } else {
                        "symbol-field".to_string()
                    };
                    TreeNode {
                        id,
                        label: col.name,
                        description: Some(col.col_type),
                        icon: Some(icon),
                        collapsible: Some(false),
                        data: Some(data),
                        ..Default::default()
                    }
                })
                .collect()
        }
        _ => vec![],
    };

    let _ = cm.end_session(&session_id).await;
    Ok(children)
}

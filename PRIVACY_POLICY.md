# WorkGrid Studio Privacy Policy

Effective date: 2026-03-14

## What WorkGrid Studio stores locally

WorkGrid Studio stores connection profiles, encrypted saved credentials, model/provider
settings, tasks, query history, layout preferences, and local log files under the
current user's `.workgrid-studio` directory.

The app may also store AI request previews, known SSH host fingerprints, and a local
secret key used to protect saved secrets for this installation.

## What WorkGrid Studio sends over the network

Database credentials are only sent to the database server or SSH host you explicitly
configure.

AI features send your prompt content and, when available, schema context such as
database names, table names, column names, and current editor text to the AI provider
you selected.

Update checks send the current app version and platform target to the configured
update service so the app can determine whether a newer version exists.

## What WorkGrid Studio does not collect

WorkGrid Studio does not include telemetry, analytics, ad tracking, or background
product-usage collection.

The project does not upload your database content anywhere unless you explicitly use a
feature that connects to a database, AI provider, or update service.

## Your controls

You can disable all AI requests with the global "Do not send data to AI" setting.

You can disable update checks, clear all log files, or use "Delete all data" to wipe
the local application directory, vault data, cached files, and logs from this machine.

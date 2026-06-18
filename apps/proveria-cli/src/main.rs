use std::{
    collections::BTreeMap,
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use clap::{Args, CommandFactory, Parser, Subcommand, ValueEnum};
use clap_complete::{Shell, generate};
use regex::Regex;
use reqwest::{
    Client, StatusCode,
    header::{COOKIE, SET_COOKIE},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use time::{Duration as TimeDuration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::time::sleep;
use unicode_normalization::UnicodeNormalization;

const DEFAULT_API_URL: &str = "http://127.0.0.1:3001";
const SESSION_COOKIE_NAME: &str = "proveria_session";
const CONTENT_PROOF_METHODS: [&str; 3] = ["plain-text/v1", "pdf-text-layer/v1", "ocr-tesseract/v1"];
const CONTENT_PROOF_PRESETS: [(&str, usize, usize); 3] =
    [("standard", 7, 1), ("broad", 12, 3), ("sensitive", 4, 1)];
const EXPORT_COLLECT_MAX_POLLS: usize = 60;

#[derive(Parser)]
#[command(name = "proveria")]
#[command(about = "Proveria CLI for API-first provenance workflows")]
#[command(version)]
struct Cli {
    #[arg(long, global = true, env = "PROVERIA_API_URL")]
    api_url: Option<String>,

    #[arg(long, global = true, env = "PROVERIA_API_KEY")]
    api_key: Option<String>,

    #[arg(long, global = true, env = "PROVERIA_WORKSPACE")]
    workspace: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Grant or revoke verifier access to an attestation.
    Access(AccessCommand),
    /// Manage admin login for session-scoped commands.
    Auth(AuthCommand),
    /// Create, list, and revoke workspace API keys.
    ApiKeys(ApiKeysCommand),
    /// List attestation records.
    Attestations(AttestationsCommand),
    /// Generate shell completions.
    Completions(CompletionsCommand),
    /// Manage local CLI configuration.
    Config(ConfigCommand),
    /// List workspace events.
    Events(EventsCommand),
    /// Export evidence, receipts, and verification artifacts.
    Export(ExportCommand),
    /// Create and submit dataset inventory provenance receipts.
    Dataset(DatasetCommand),
    /// Compute a local SHA-256 hash.
    Hash(HashCommand),
    /// Create and submit model release provenance receipts.
    ModelRelease(ModelReleaseCommand),
    /// Manage projects.
    Projects(ProjectsCommand),
    /// Create a proof record from a file or SHA-256 hash.
    Prove(ProveCommand),
    /// Read attestation records.
    Records(RecordsCommand),
    /// Download attestation receipt artifacts.
    Receipt(ReceiptCommand),
    /// Download verification result artifacts.
    Result(ResultCommand),
    /// Verify a file, SHA-256 hash, or text passage.
    Verify(VerifyCommand),
    /// Manage webhook endpoints and deliveries.
    Webhooks(WebhooksCommand),
}

#[derive(Args)]
struct AccessCommand {
    #[command(subcommand)]
    command: AccessSubcommand,
}

#[derive(Subcommand)]
enum AccessSubcommand {
    /// Grant a verifier access to one attestation.
    Grant(AccessGrant),
    /// Revoke an existing verifier access grant.
    Revoke(AccessRevoke),
}

#[derive(Args)]
struct AccessGrant {
    #[arg(value_name = "ATTESTATION")]
    attestation: String,

    #[arg(long)]
    email: String,

    #[arg(long)]
    message: Option<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct AccessRevoke {
    #[arg(value_name = "ATTESTATION")]
    attestation: String,

    #[arg(long)]
    grant: String,
}

#[derive(Args)]
struct AuthCommand {
    #[command(subcommand)]
    command: AuthSubcommand,
}

#[derive(Subcommand)]
enum AuthSubcommand {
    /// Sign in with a Proveria admin account and save the session locally.
    Login(AuthLogin),
    /// Remove the saved admin session from local CLI config.
    Logout,
}

#[derive(Args)]
struct AuthLogin {
    #[arg(long)]
    email: String,

    #[arg(long)]
    password: String,
}

#[derive(Args)]
struct ApiKeysCommand {
    #[command(subcommand)]
    command: ApiKeysSubcommand,
}

#[derive(Subcommand)]
enum ApiKeysSubcommand {
    /// Create a workspace API key. The token is shown once.
    Create(ApiKeyCreate),
    /// List workspace API keys.
    List(ApiKeyList),
    /// Create a replacement key and revoke an existing key.
    Rotate(ApiKeyRotate),
    /// Revoke a workspace API key.
    Revoke(ApiKeyRevoke),
}

#[derive(Args)]
struct ApiKeyCreate {
    #[arg(long)]
    name: String,

    #[arg(long = "scope")]
    scopes: Vec<String>,

    #[arg(
        long,
        value_name = "DURATION",
        help = "Expire the key after a duration such as 30d, 12h, or 90m."
    )]
    expires_in: Option<String>,

    #[arg(long, help = "Save the returned token as the active CLI API key.")]
    use_key: bool,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ApiKeyRotate {
    #[arg(value_name = "API_KEY_ID")]
    id: String,

    #[arg(long, help = "Name for the replacement key.")]
    name: Option<String>,

    #[arg(long = "scope")]
    scopes: Vec<String>,

    #[arg(
        long,
        value_name = "DURATION",
        help = "Expire the replacement key after a duration such as 30d, 12h, or 90m."
    )]
    expires_in: Option<String>,

    #[arg(long, help = "Save the replacement token as the active CLI API key.")]
    use_key: bool,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ApiKeyList {
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ApiKeyRevoke {
    #[arg(value_name = "API_KEY_ID")]
    id: String,
}

#[derive(Args)]
struct CompletionsCommand {
    #[arg(value_enum)]
    shell: Shell,
}

#[derive(Args)]
struct AttestationsCommand {
    #[arg(long)]
    project: Option<String>,

    #[arg(long)]
    status: Option<String>,

    #[arg(long)]
    limit: Option<u32>,

    #[arg(long)]
    offset: Option<u32>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ConfigCommand {
    #[command(subcommand)]
    command: ConfigSubcommand,
}

#[derive(Subcommand)]
enum ConfigSubcommand {
    Set(ConfigSet),
    Show,
}

#[derive(Args)]
struct ConfigSet {
    #[arg(long)]
    api_url: Option<String>,

    #[arg(long)]
    api_key: Option<String>,

    #[arg(long)]
    workspace: Option<String>,
}

#[derive(Args)]
struct EventsCommand {
    #[arg(long)]
    category: Option<String>,

    #[arg(long)]
    action: Option<String>,

    #[arg(long)]
    target_type: Option<String>,

    #[arg(long)]
    target_id: Option<String>,

    #[arg(long)]
    limit: Option<u32>,

    #[arg(long)]
    offset: Option<u32>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ExportCommand {
    #[arg(long)]
    project_id: Option<String>,

    #[arg(long)]
    actor_user_id: Option<String>,

    #[arg(long)]
    no_events: bool,

    #[arg(long)]
    limit: Option<u32>,

    #[arg(long, value_name = "FILE")]
    output: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<ExportSubcommand>,
}

#[derive(Subcommand)]
enum ExportSubcommand {
    Jobs(ExportJobs),
    Get(ExportGet),
    Bundle(ExportBundle),
    Inspect(ExportInspect),
    Check(ExportCheck),
    Unpack(ExportUnpack),
    Zip(ExportZip),
    Tar(ExportTar),
    Collect(ExportCollect),
    Create(ExportCreate),
}

#[derive(Args)]
struct ExportJobs {
    #[arg(long)]
    limit: Option<u32>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ExportGet {
    #[arg(value_name = "JOB_ID")]
    job_id: String,

    #[arg(long, value_name = "FILE")]
    output: Option<PathBuf>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,
}

#[derive(Args)]
struct ExportBundle {
    #[arg(value_name = "JOB_ID")]
    job_id: String,

    #[arg(long, value_name = "FILE")]
    output: Option<PathBuf>,
}

#[derive(Args)]
struct ExportUnpack {
    #[arg(value_name = "BUNDLE_JSON")]
    bundle: PathBuf,

    #[arg(long, value_name = "DIR")]
    output: PathBuf,
}

#[derive(Args)]
struct ExportInspect {
    #[arg(value_name = "BUNDLE_JSON")]
    bundle: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ExportCheck {
    #[arg(
        value_name = "PATH",
        help = "Bundle JSON file or collected evidence directory"
    )]
    path: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ExportZip {
    #[arg(value_name = "BUNDLE_JSON")]
    bundle: PathBuf,

    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Args)]
struct ExportTar {
    #[arg(value_name = "BUNDLE_JSON", help = "Evidence bundle JSON file")]
    bundle: PathBuf,

    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Args)]
struct ExportCollect {
    #[arg(long)]
    project_id: Option<String>,

    #[arg(long)]
    actor_user_id: Option<String>,

    #[arg(long)]
    no_events: bool,

    #[arg(long)]
    limit: Option<u32>,

    #[arg(long, value_name = "DIR")]
    output: PathBuf,

    #[arg(long, value_name = "FILE")]
    zip: Option<PathBuf>,

    #[arg(long, value_name = "FILE")]
    tar: Option<PathBuf>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,
}

#[derive(Args)]
struct ExportCreate {
    #[arg(long)]
    project_id: Option<String>,

    #[arg(long)]
    actor_user_id: Option<String>,

    #[arg(long)]
    no_events: bool,

    #[arg(long)]
    limit: Option<u32>,

    #[arg(long, value_name = "FILE")]
    output: Option<PathBuf>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    format: OutputFormat,
}

#[derive(Args)]
struct HashCommand {
    #[arg(value_name = "FILE")]
    file: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct DatasetCommand {
    #[command(subcommand)]
    command: DatasetSubcommand,
}

#[derive(Subcommand)]
enum DatasetSubcommand {
    /// Write a starter dataset inventory record JSON file.
    Init(DatasetInit),
    /// Hash a local folder into a dataset inventory record.
    Collect(DatasetCollect),
    /// Compare two dataset inventory records into a revision record.
    Revision(DatasetRevision),
    /// Inspect the canonical hash and API metadata for a dataset inventory record.
    Inspect(DatasetInspect),
    /// Canonicalize, hash, and attest a dataset inventory or revision record.
    Attest(DatasetAttest),
}

#[derive(Args)]
struct DatasetInit {
    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Args)]
struct DatasetCollect {
    #[arg(value_name = "DIR")]
    input: PathBuf,

    #[arg(long, value_name = "FILE")]
    output: PathBuf,

    #[arg(long)]
    name: String,

    #[arg(long)]
    version: String,

    #[arg(long, default_value = "folder")]
    scope: String,

    #[arg(long, default_value = "internal")]
    classification: String,

    #[arg(long)]
    source_owner: Option<String>,

    #[arg(long)]
    license_usage_basis: Option<String>,

    #[arg(long)]
    retention_rule: Option<String>,
}

#[derive(Args)]
struct DatasetRevision {
    #[arg(long, value_name = "DATASET_INVENTORY_JSON")]
    base: PathBuf,

    #[arg(long, value_name = "DATASET_INVENTORY_JSON")]
    next: PathBuf,

    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Args)]
struct DatasetInspect {
    #[arg(value_name = "DATASET_RECORD_JSON")]
    file: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct DatasetAttest {
    #[arg(value_name = "DATASET_RECORD_JSON")]
    file: PathBuf,

    #[arg(long)]
    project: String,

    #[arg(long, alias = "label")]
    name: Option<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ModelReleaseCommand {
    #[command(subcommand)]
    command: ModelReleaseSubcommand,
}

#[derive(Subcommand)]
enum ModelReleaseSubcommand {
    /// Write a starter model provenance record JSON file.
    Init(ModelReleaseInit),
    /// Canonicalize, hash, and attest a model provenance record.
    Attest(ModelReleaseAttest),
    /// Inspect the canonical hash and API metadata for a model provenance record.
    Inspect(ModelReleaseInspect),
}

#[derive(Args)]
struct ModelReleaseInit {
    #[arg(long, value_name = "FILE")]
    output: PathBuf,
}

#[derive(Args)]
struct ModelReleaseAttest {
    #[arg(value_name = "MODEL_RELEASE_JSON")]
    file: PathBuf,

    #[arg(long)]
    project: String,

    #[arg(long, alias = "label")]
    name: Option<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ModelReleaseInspect {
    #[arg(value_name = "MODEL_RELEASE_JSON")]
    file: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ProjectsCommand {
    #[command(subcommand)]
    command: ProjectsSubcommand,
}

#[derive(Subcommand)]
enum ProjectsSubcommand {
    Create(ProjectCreate),
    List,
}

#[derive(Args)]
struct ProjectCreate {
    #[arg(value_name = "SLUG")]
    slug: String,

    #[arg(long)]
    name: String,

    #[arg(long)]
    description: Option<String>,

    #[arg(long)]
    classification: Option<String>,

    #[arg(long = "tag")]
    tags: Vec<String>,

    #[arg(long, value_enum)]
    visibility: Option<ProjectVisibility>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct RecordsCommand {
    #[command(subcommand)]
    command: RecordsSubcommand,
}

#[derive(Subcommand)]
enum RecordsSubcommand {
    Get(RecordsGet),
}

#[derive(Args)]
struct RecordsGet {
    #[arg(value_name = "ATTESTATION")]
    attestation: String,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ProveCommand {
    #[arg(value_name = "INPUT")]
    input: Option<String>,

    #[arg(long)]
    project: Option<String>,

    #[arg(long, alias = "label")]
    name: Option<String>,

    #[arg(long, value_name = "FILE")]
    compliance_json: Option<PathBuf>,

    #[arg(long)]
    file_name: Option<String>,

    #[arg(long)]
    byte_size: Option<u64>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,

    #[command(subcommand)]
    command: Option<ProveSubcommand>,
}

#[derive(Subcommand)]
enum ProveSubcommand {
    Hash(ProveHash),
    File(ProveFile),
}

#[derive(Args)]
struct ProveHash {
    #[arg(value_name = "SHA256")]
    sha256: String,

    #[arg(long)]
    project: String,

    #[arg(long, alias = "label")]
    name: String,

    #[arg(long)]
    file_name: Option<String>,

    #[arg(long)]
    byte_size: Option<u64>,

    #[arg(long, value_name = "FILE")]
    compliance_json: Option<PathBuf>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ProveFile {
    #[arg(value_name = "FILE")]
    file: PathBuf,

    #[arg(long)]
    project: String,

    #[arg(long, alias = "label")]
    name: Option<String>,

    #[arg(long, value_name = "FILE")]
    compliance_json: Option<PathBuf>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct ReceiptCommand {
    #[arg(value_name = "ATTESTATION")]
    attestation: String,

    #[arg(long, help = "Download the signed receipt JSON artifact.")]
    json: bool,

    #[arg(long, help = "Download the human-readable receipt PDF artifact.")]
    pdf: bool,

    #[arg(
        long,
        value_name = "DIR",
        help = "Directory for downloaded artifacts. Use with --json or --pdf."
    )]
    output: Option<PathBuf>,
}

#[derive(Args)]
struct ResultCommand {
    #[arg(value_name = "LINK_ID")]
    link_id: String,

    #[arg(long, help = "Download the verification result JSON artifact.")]
    json: bool,

    #[arg(long, help = "Download the verification result PDF artifact.")]
    pdf: bool,

    #[arg(
        long,
        value_name = "DIR",
        help = "Directory for downloaded artifacts. Use with --json or --pdf."
    )]
    output: Option<PathBuf>,
}

#[derive(Args)]
struct VerifyCommand {
    #[arg(value_name = "INPUT")]
    input: Option<String>,

    #[arg(long)]
    attestation: Option<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,

    #[command(subcommand)]
    command: Option<VerifySubcommand>,
}

#[derive(Subcommand)]
enum VerifySubcommand {
    Hash(VerifyHash),
    File(VerifyFile),
    Passage(VerifyPassage),
}

#[derive(Args)]
struct VerifyHash {
    #[arg(value_name = "SHA256")]
    sha256: String,

    #[arg(long)]
    attestation: String,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct VerifyFile {
    #[arg(value_name = "FILE")]
    file: PathBuf,

    #[arg(long)]
    attestation: String,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct VerifyPassage {
    #[arg(value_name = "TEXT")]
    text: String,

    #[arg(long)]
    attestation: String,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct WebhooksCommand {
    #[command(subcommand)]
    command: WebhooksSubcommand,
}

#[derive(Subcommand)]
enum WebhooksSubcommand {
    /// Create a webhook endpoint subscription.
    Create(WebhookCreate),
    /// List webhook delivery attempts.
    Deliveries(WebhookDeliveries),
    /// Disable a webhook endpoint.
    Disable(WebhookDisable),
    /// List webhook endpoints.
    List(WebhookList),
    /// Send a test event to a webhook endpoint.
    Test(WebhookTest),
}

#[derive(Args)]
struct WebhookCreate {
    #[arg(long)]
    url: String,

    #[arg(long = "event")]
    events: Vec<String>,

    #[arg(long)]
    description: Option<String>,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct WebhookList {
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct WebhookDisable {
    #[arg(value_name = "ENDPOINT")]
    endpoint: String,
}

#[derive(Args)]
struct WebhookTest {
    #[arg(value_name = "ENDPOINT")]
    endpoint: String,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Args)]
struct WebhookDeliveries {
    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    output: OutputFormat,
}

#[derive(Clone, Copy, ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

#[derive(Clone, Copy, ValueEnum)]
enum ProjectVisibility {
    Public,
    Private,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ConfigFile {
    api_url: Option<String>,
    api_key: Option<String>,
    workspace: Option<String>,
    session_cookie: Option<String>,
    session_email: Option<String>,
}

#[derive(Clone)]
struct AppContext {
    api_url: String,
    api_key: Option<String>,
    workspace: Option<String>,
    session_cookie: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProjectsResponse {
    data: Vec<Project>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ProjectResponse {
    data: Project,
}

#[derive(Debug, Deserialize, Serialize)]
struct Project {
    id: String,
    slug: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeysResponse {
    api_keys: Vec<ApiKeyRecord>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyCreateResponse {
    api_key: ApiKeyRecord,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyRotateResponse {
    api_key: ApiKeyRecord,
    token: String,
    revoked_api_key_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyRecord {
    id: String,
    name: String,
    key_prefix: String,
    scopes: Vec<String>,
    workspace: Option<WorkspaceSummary>,
    created_by_user_id: Option<String>,
    created_at: String,
    expires_at: Option<String>,
    last_used_at: Option<String>,
    usage_count: Option<u64>,
    last_used_method: Option<String>,
    last_used_path: Option<String>,
    last_used_status_code: Option<u16>,
    revoked_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    slug: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttestationsResponse {
    data: Vec<Attestation>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttestationResponse {
    data: Attestation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Attestation {
    id: String,
    label: String,
    state: String,
    project: Option<AttestationProject>,
    merkle_root: Option<String>,
    package_id: Option<String>,
    receipt_available: bool,
    created_at: String,
    confirmed_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AttestationProject {
    id: String,
    slug: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventsResponse {
    data: Vec<Event>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    category: String,
    action: String,
    target_type: Option<String>,
    target_id: Option<String>,
    payload: serde_json::Value,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResponse {
    data: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportJobsResponse {
    data: Vec<ExportJob>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportJobResponse {
    data: ExportJobData,
}

#[derive(Debug, Deserialize, Serialize)]
struct ExportJobData {
    job: ExportJob,
    manifest: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportJob {
    id: String,
    kind: String,
    status: String,
    filters: serde_json::Value,
    artifact_count: i64,
    row_count: i64,
    result_object_key: Option<String>,
    error: Option<String>,
    progress_percent: i64,
    retry_count: i64,
    max_retries: i64,
    expires_at: Option<String>,
    retention_policy: serde_json::Value,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportBundle {
    schema_version: String,
    #[serde(rename = "type")]
    bundle_type: String,
    generated_at: String,
    manifest: serde_json::Value,
    artifacts: Vec<EvidenceExportBundleArtifact>,
    missing_artifacts: Vec<EvidenceExportBundleMissingArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportBundleArtifact {
    path: String,
    object_key: String,
    content_type: String,
    encoding: String,
    byte_size: usize,
    body_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportBundleMissingArtifact {
    path: String,
    object_key: String,
    reason: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportBundleInspection {
    schema_version: String,
    bundle_type: String,
    generated_at: String,
    artifact_count: usize,
    missing_artifact_count: usize,
    total_artifact_bytes: usize,
    manifest_counts: Option<serde_json::Value>,
    artifacts: Vec<EvidenceExportBundleArtifactSummary>,
    missing_artifacts: Vec<EvidenceExportBundleMissingArtifact>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportBundleArtifactSummary {
    path: String,
    content_type: String,
    byte_size: usize,
    object_key: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportPackageCheck {
    path: String,
    kind: String,
    valid: bool,
    artifact_count: usize,
    missing_artifact_count: usize,
    total_artifact_bytes: usize,
    checked_files: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceExportCollectionSummary {
    job: ExportJob,
    output_dir: String,
    manifest_path: String,
    bundle_path: String,
    zip_path: Option<String>,
    tar_path: Option<String>,
    unpacked_artifact_count: usize,
    missing_artifact_count: usize,
    total_artifact_bytes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAttestationResponse {
    data: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LookupResponse {
    data: LookupData,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LookupData {
    package_id: String,
    link_id: String,
    signed: bool,
    retrieve_url: String,
    verification_url: String,
    package: LookupPackage,
}

#[derive(Debug, Deserialize, Serialize)]
struct LookupPackage {
    result_type: String,
    submitted_hash: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptResponse {
    data: ReceiptData,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptData {
    attestation_id: String,
    attestation_label: String,
    state: String,
    package_id: Option<String>,
    merkle_root: Option<String>,
    receipt_available: bool,
    receipt_pdf_available: bool,
    confirmed_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessGrantResponse {
    data: AccessGrantData,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessGrantData {
    id: String,
    attestation_id: String,
    granted_to_email: String,
    status: String,
    created_at: String,
    claimed_at: Option<String>,
    revoked_at: Option<String>,
    claim_token: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookEndpointsResponse {
    data: Vec<WebhookEndpoint>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookEndpointResponse {
    data: WebhookEndpoint,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookEndpoint {
    id: String,
    url: String,
    description: Option<String>,
    events: Vec<String>,
    created_at: String,
    disabled_at: Option<String>,
    signing_secret: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookDeliveriesResponse {
    data: Vec<WebhookDelivery>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookDeliveryResponse {
    data: WebhookDelivery,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookDelivery {
    id: String,
    endpoint_id: String,
    event_type: String,
    status: String,
    attempts: i64,
    response_status: Option<i64>,
    created_at: String,
    last_attempt_at: Option<String>,
    next_attempt_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PublicApiErrorEnvelope {
    error: PublicApiErrorBody,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicApiErrorBody {
    code: String,
    message: String,
    retryable: bool,
    request_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicResolvedLink {
    link: PublicLinkMeta,
    target_type: String,
    payload: serde_json::Value,
    signed: bool,
    signature_valid: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicLinkMeta {
    id: String,
    created_at: String,
    expires_at: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = std::env::args()
        .enumerate()
        .filter_map(|(index, arg)| {
            if index > 0 && arg == "--" {
                None
            } else {
                Some(arg)
            }
        })
        .collect::<Vec<_>>();
    let cli = Cli::parse_from(args);
    let config = load_config()?;
    let ctx = AppContext {
        api_url: cli
            .api_url
            .or_else(|| config.api_url.clone())
            .unwrap_or_else(|| DEFAULT_API_URL.to_string())
            .trim_end_matches('/')
            .to_string(),
        api_key: cli.api_key.or_else(|| config.api_key.clone()),
        workspace: cli.workspace.or_else(|| config.workspace.clone()),
        session_cookie: config.session_cookie.clone(),
    };

    match cli.command {
        Command::Access(command) => run_access(ctx, command).await,
        Command::Auth(command) => run_auth(ctx, command).await,
        Command::ApiKeys(command) => run_api_keys(ctx, command).await,
        Command::Attestations(command) => run_attestations(ctx, command).await,
        Command::Completions(command) => run_completions(command),
        Command::Config(command) => run_config(command).await,
        Command::Dataset(command) => run_dataset(ctx, command).await,
        Command::Events(command) => run_events(ctx, command).await,
        Command::Export(command) => run_export(ctx, command).await,
        Command::Hash(command) => run_hash(command),
        Command::ModelRelease(command) => run_model_release(ctx, command).await,
        Command::Projects(command) => run_projects(ctx, command).await,
        Command::Prove(command) => run_prove(ctx, command).await,
        Command::Records(command) => run_records(ctx, command).await,
        Command::Receipt(command) => run_receipt(ctx, command).await,
        Command::Result(command) => run_result(ctx, command).await,
        Command::Verify(command) => run_verify(ctx, command).await,
        Command::Webhooks(command) => run_webhooks(ctx, command).await,
    }
}

fn run_completions(command: CompletionsCommand) -> Result<()> {
    let mut cli = Cli::command();
    generate(command.shell, &mut cli, "proveria", &mut std::io::stdout());
    Ok(())
}

async fn run_access(ctx: AppContext, command: AccessCommand) -> Result<()> {
    match command.command {
        AccessSubcommand::Grant(input) => {
            let workspace = require_workspace(&ctx)?;
            let email = input.email.trim().to_lowercase();
            if email.is_empty() {
                bail!("verifier email is required");
            }
            let mut body = serde_json::Map::new();
            body.insert("email".to_string(), json!(email));
            if let Some(message) = input.message {
                body.insert("message".to_string(), json!(message));
            }
            let idempotency_key =
                access_grant_idempotency_key(workspace, &input.attestation, &input.email);
            let response = api_post::<AccessGrantResponse>(
                &ctx,
                &format!(
                    "/v1/tenants/{workspace}/attestations/{}/verifier-access",
                    input.attestation
                ),
                serde_json::Value::Object(body),
                Some(idempotency_key),
            )
            .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => print_access_grant(&response.data),
            }
            Ok(())
        }
        AccessSubcommand::Revoke(input) => {
            let workspace = require_workspace(&ctx)?;
            api_delete(
                &ctx,
                &format!(
                    "/v1/tenants/{workspace}/attestations/{}/verifier-access/{}",
                    input.attestation, input.grant
                ),
            )
            .await?;
            println!("Revoked verifier access grant {}", input.grant);
            Ok(())
        }
    }
}

fn print_access_grant(grant: &AccessGrantData) {
    println!("Verifier access: {}", grant.status);
    println!("grant_id: {}", grant.id);
    println!("attestation_id: {}", grant.attestation_id);
    println!("email: {}", grant.granted_to_email);
    println!("created_at: {}", grant.created_at);
    if let Some(claimed_at) = &grant.claimed_at {
        println!("claimed_at: {claimed_at}");
    }
    if let Some(revoked_at) = &grant.revoked_at {
        println!("revoked_at: {revoked_at}");
    }
    if let Some(claim_token) = &grant.claim_token {
        println!("claim_token: {claim_token}");
    }
}

async fn run_attestations(ctx: AppContext, command: AttestationsCommand) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let mut query = Vec::new();
    if let Some(project_slug) = command.project {
        query.push(("project", project_slug));
    }
    if let Some(status) = command.status {
        query.push(("status", status));
    }
    if let Some(limit) = command.limit {
        query.push(("limit", limit.to_string()));
    }
    if let Some(offset) = command.offset {
        query.push(("offset", offset.to_string()));
    }
    let mut path = format!("/v1/tenants/{workspace}/attestations");
    append_query(&mut path, query);
    let response = api_get::<AttestationsResponse>(&ctx, &path).await?;
    match command.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            if response.data.is_empty() {
                println!("No attestations found.");
                return Ok(());
            }
            println!("STATE\tRECEIPT\tPROJECT\tLABEL\tID");
            for attestation in response.data {
                let project = attestation
                    .project
                    .as_ref()
                    .map(|project| project.slug.as_str())
                    .unwrap_or("-");
                let receipt = if attestation.receipt_available {
                    "yes"
                } else {
                    "no"
                };
                println!(
                    "{}\t{}\t{}\t{}\t{}",
                    attestation.state, receipt, project, attestation.label, attestation.id
                );
            }
        }
    }
    Ok(())
}

async fn run_events(ctx: AppContext, command: EventsCommand) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let mut query = Vec::new();
    if let Some(category) = command.category {
        query.push(("category", category));
    }
    if let Some(action) = command.action {
        query.push(("action", action));
    }
    if let Some(target_type) = command.target_type {
        query.push(("targetType", target_type));
    }
    if let Some(target_id) = command.target_id {
        query.push(("targetId", target_id));
    }
    if let Some(limit) = command.limit {
        query.push(("limit", limit.to_string()));
    }
    if let Some(offset) = command.offset {
        query.push(("offset", offset.to_string()));
    }
    let mut path = format!("/v1/tenants/{workspace}/events");
    append_query(&mut path, query);
    let response = api_get::<EventsResponse>(&ctx, &path).await?;
    match command.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            if response.data.is_empty() {
                println!("No events found.");
                return Ok(());
            }
            println!("CREATED\tCATEGORY\tACTION\tTARGET\tID");
            for event in response.data {
                let target_type = event.target_type.as_deref().unwrap_or("-");
                let target_id = event.target_id.as_deref().unwrap_or("-");
                println!(
                    "{}\t{}\t{}\t{}:{}\t{}",
                    event.created_at,
                    event.category,
                    event.action,
                    target_type,
                    target_id,
                    event.id
                );
            }
        }
    }
    Ok(())
}

async fn run_export(ctx: AppContext, command: ExportCommand) -> Result<()> {
    if command.command.is_some() {
        ensure_no_legacy_export_flags(&command)?;
    }
    match command.command {
        Some(ExportSubcommand::Jobs(input)) => return run_export_jobs(ctx, input).await,
        Some(ExportSubcommand::Get(input)) => return run_export_get(ctx, input).await,
        Some(ExportSubcommand::Bundle(input)) => return run_export_bundle(ctx, input).await,
        Some(ExportSubcommand::Inspect(input)) => return run_export_inspect(input),
        Some(ExportSubcommand::Check(input)) => return run_export_check(input),
        Some(ExportSubcommand::Unpack(input)) => return run_export_unpack(input),
        Some(ExportSubcommand::Zip(input)) => return run_export_zip(input),
        Some(ExportSubcommand::Tar(input)) => return run_export_tar(input),
        Some(ExportSubcommand::Collect(input)) => return run_export_collect(ctx, input).await,
        Some(ExportSubcommand::Create(input)) => return run_export_create(ctx, input).await,
        None => {}
    }
    let workspace = require_workspace(&ctx)?;
    let mut query = Vec::new();
    if let Some(project_id) = command.project_id {
        query.push(("projectId", project_id));
    }
    if let Some(actor_user_id) = command.actor_user_id {
        query.push(("actorUserId", actor_user_id));
    }
    query.push(("includeEvents", (!command.no_events).to_string()));
    if let Some(limit) = command.limit {
        query.push(("limit", limit.to_string()));
    }
    let mut path = format!("/v1/tenants/{workspace}/evidence-export/manifest");
    append_query(&mut path, query);
    let response = api_get::<ExportResponse>(&ctx, &path).await?;
    let json = serde_json::to_string_pretty(&response.data)?;
    if let Some(output) = command.output {
        fs::write(&output, json)
            .with_context(|| format!("could not write {}", output.display()))?;
        println!("Wrote {}", output.display());
    } else {
        println!("{json}");
    }
    Ok(())
}

fn ensure_no_legacy_export_flags(command: &ExportCommand) -> Result<()> {
    if command.project_id.is_some()
        || command.actor_user_id.is_some()
        || command.no_events
        || command.limit.is_some()
        || command.output.is_some()
    {
        bail!(
            "put export filters after the export subcommand, for example `proveria export create --limit 100`"
        );
    }
    Ok(())
}

fn evidence_export_request_body(
    project_id: Option<String>,
    actor_user_id: Option<String>,
    no_events: bool,
    limit: Option<u32>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut body = serde_json::Map::new();
    if let Some(project_id) = project_id {
        body.insert("projectId".to_string(), json!(project_id));
    }
    if let Some(actor_user_id) = actor_user_id {
        body.insert("actorUserId".to_string(), json!(actor_user_id));
    }
    body.insert("includeEvents".to_string(), json!(!no_events));
    if let Some(limit) = limit {
        body.insert("limit".to_string(), json!(limit));
    }
    body
}

async fn run_export_jobs(ctx: AppContext, input: ExportJobs) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let mut query = Vec::new();
    if let Some(limit) = input.limit {
        query.push(("limit", limit.to_string()));
    }
    let mut path = format!("/v1/tenants/{workspace}/evidence-export/jobs");
    append_query(&mut path, query);
    let response = api_get::<ExportJobsResponse>(&ctx, &path).await?;
    match input.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            if response.data.is_empty() {
                println!("No evidence export jobs found.");
                return Ok(());
            }
            println!("CREATED\tSTATUS\tPROGRESS\tARTIFACTS\tROWS\tEXPIRES\tID");
            for job in response.data {
                println!(
                    "{}\t{}\t{}%\t{}\t{}\t{}\t{}",
                    job.created_at,
                    job.status,
                    job.progress_percent,
                    job.artifact_count,
                    job.row_count,
                    job.expires_at.as_deref().unwrap_or("never"),
                    job.id
                );
            }
        }
    }
    Ok(())
}

async fn run_export_get(ctx: AppContext, input: ExportGet) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let response = api_get::<ExportJobResponse>(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/evidence-export/jobs/{}",
            input.job_id
        ),
    )
    .await?;
    let wrote_output = input.output.is_some();
    if let Some(output) = input.output {
        let json = serde_json::to_string_pretty(&response.data.manifest)?;
        fs::write(&output, json)
            .with_context(|| format!("could not write {}", output.display()))?;
        println!("Wrote {}", output.display());
    }
    match input.format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            println!("Evidence export job {}", response.data.job.id);
            println!("status: {}", response.data.job.status);
            println!("progress: {}%", response.data.job.progress_percent);
            println!("artifact_count: {}", response.data.job.artifact_count);
            println!("row_count: {}", response.data.job.row_count);
            println!(
                "retries: {}/{}",
                response.data.job.retry_count, response.data.job.max_retries
            );
            if let Some(expires_at) = response.data.job.expires_at.as_deref() {
                println!("expires_at: {expires_at}");
            }
            if let Some(completed_at) = response.data.job.completed_at {
                println!("completed_at: {completed_at}");
            }
            if !wrote_output {
                println!("{}", serde_json::to_string_pretty(&response.data.manifest)?);
            }
        }
    }
    Ok(())
}

async fn run_export_bundle(ctx: AppContext, input: ExportBundle) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let output = input
        .output
        .unwrap_or_else(|| PathBuf::from(format!("{}.evidence-bundle.json", input.job_id)));
    let bytes = api_get_bytes(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/evidence-export/jobs/{}/bundle",
            input.job_id
        ),
    )
    .await?;
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    fs::write(&output, bytes).with_context(|| format!("could not write {}", output.display()))?;
    println!("Wrote {}", output.display());
    Ok(())
}

fn run_export_unpack(input: ExportUnpack) -> Result<()> {
    let bundle = load_evidence_bundle(&input.bundle)?;
    unpack_evidence_bundle(&bundle, &input.output)?;
    println!(
        "Unpacked {} artifact(s) to {}",
        bundle.artifacts.len(),
        input.output.display()
    );
    if !bundle.missing_artifacts.is_empty() {
        println!(
            "{} artifact(s) were missing; wrote missing-artifacts.json",
            bundle.missing_artifacts.len()
        );
    }
    Ok(())
}

fn run_export_inspect(input: ExportInspect) -> Result<()> {
    let bundle = load_evidence_bundle(&input.bundle)?;
    let inspection = inspect_evidence_bundle(&bundle)?;
    match input.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&inspection)?),
        OutputFormat::Text => print_evidence_bundle_inspection(&inspection),
    }
    Ok(())
}

fn run_export_check(input: ExportCheck) -> Result<()> {
    let check = check_evidence_export_package(&input.path)?;
    match input.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&check)?),
        OutputFormat::Text => print_evidence_export_package_check(&check),
    }
    Ok(())
}

fn run_export_zip(input: ExportZip) -> Result<()> {
    let bundle = load_evidence_bundle(&input.bundle)?;
    write_evidence_bundle_zip(&bundle, &input.output)?;
    println!("Wrote {}", input.output.display());
    Ok(())
}

fn run_export_tar(input: ExportTar) -> Result<()> {
    let bundle = load_evidence_bundle(&input.bundle)?;
    write_evidence_bundle_tar(&bundle, &input.output)?;
    println!("Wrote {}", input.output.display());
    Ok(())
}

async fn wait_for_export_job(
    ctx: &AppContext,
    workspace: &str,
    job_id: &str,
) -> Result<ExportJobResponse> {
    for _ in 0..EXPORT_COLLECT_MAX_POLLS {
        let response = api_get::<ExportJobResponse>(
            ctx,
            &format!("/v1/tenants/{workspace}/evidence-export/jobs/{job_id}"),
        )
        .await?;
        match response.data.job.status.as_str() {
            "completed" => return Ok(response),
            "failed" => {
                let message = response
                    .data
                    .job
                    .error
                    .clone()
                    .unwrap_or_else(|| "evidence export failed".to_string());
                bail!("{message}");
            }
            _ => sleep(Duration::from_secs(1)).await,
        }
    }
    bail!("evidence export did not complete before the wait timeout");
}

async fn run_export_collect(ctx: AppContext, input: ExportCollect) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    fs::create_dir_all(&input.output)
        .with_context(|| format!("could not create {}", input.output.display()))?;

    let body = evidence_export_request_body(
        input.project_id,
        input.actor_user_id,
        input.no_events,
        input.limit,
    );
    let idempotency_key = evidence_export_idempotency_key(workspace, &body);
    let response = api_post::<ExportJobResponse>(
        &ctx,
        &format!("/v1/tenants/{workspace}/evidence-export/jobs"),
        serde_json::Value::Object(body),
        Some(idempotency_key),
    )
    .await?;
    let job = wait_for_export_job(&ctx, workspace, &response.data.job.id)
        .await?
        .data
        .job;
    let manifest_path = input.output.join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&response.data.manifest)?,
    )
    .with_context(|| format!("could not write {}", manifest_path.display()))?;

    let bundle_path = input.output.join("bundle.json");
    let bundle_bytes = api_get_bytes(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/evidence-export/jobs/{}/bundle",
            job.id
        ),
    )
    .await?;
    fs::write(&bundle_path, &bundle_bytes)
        .with_context(|| format!("could not write {}", bundle_path.display()))?;
    let bundle: EvidenceExportBundle = serde_json::from_slice(&bundle_bytes)
        .with_context(|| format!("could not parse {}", bundle_path.display()))?;
    let inspection = inspect_evidence_bundle(&bundle)?;
    unpack_evidence_bundle(&bundle, &input.output)?;
    if let Some(zip_path) = &input.zip {
        write_evidence_bundle_zip(&bundle, zip_path)?;
    }
    if let Some(tar_path) = &input.tar {
        write_evidence_bundle_tar(&bundle, tar_path)?;
    }

    let summary = EvidenceExportCollectionSummary {
        job,
        output_dir: input.output.display().to_string(),
        manifest_path: manifest_path.display().to_string(),
        bundle_path: bundle_path.display().to_string(),
        zip_path: input.zip.as_ref().map(|path| path.display().to_string()),
        tar_path: input.tar.as_ref().map(|path| path.display().to_string()),
        unpacked_artifact_count: inspection.artifact_count,
        missing_artifact_count: inspection.missing_artifact_count,
        total_artifact_bytes: inspection.total_artifact_bytes,
    };
    let summary_path = input.output.join("summary.json");
    fs::write(&summary_path, serde_json::to_vec_pretty(&summary)?)
        .with_context(|| format!("could not write {}", summary_path.display()))?;

    match input.format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&summary)?),
        OutputFormat::Text => {
            println!("Collected evidence export {}", summary.job.id);
            println!("status: {}", summary.job.status);
            println!("output_dir: {}", summary.output_dir);
            println!("manifest: {}", summary.manifest_path);
            println!("bundle: {}", summary.bundle_path);
            if let Some(zip_path) = &summary.zip_path {
                println!("zip: {zip_path}");
            }
            if let Some(tar_path) = &summary.tar_path {
                println!("tar: {tar_path}");
            }
            println!("summary: {}", summary_path.display());
            println!("artifacts: {}", summary.unpacked_artifact_count);
            println!("missing_artifacts: {}", summary.missing_artifact_count);
            println!("total_artifact_bytes: {}", summary.total_artifact_bytes);
        }
    }
    Ok(())
}

async fn run_export_create(ctx: AppContext, input: ExportCreate) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let body = evidence_export_request_body(
        input.project_id,
        input.actor_user_id,
        input.no_events,
        input.limit,
    );
    let idempotency_key = evidence_export_idempotency_key(workspace, &body);
    let response = api_post::<ExportJobResponse>(
        &ctx,
        &format!("/v1/tenants/{workspace}/evidence-export/jobs"),
        serde_json::Value::Object(body),
        Some(idempotency_key),
    )
    .await?;
    if let Some(output) = input.output {
        let json = serde_json::to_string_pretty(&response.data.manifest)?;
        fs::write(&output, json)
            .with_context(|| format!("could not write {}", output.display()))?;
        println!("Wrote {}", output.display());
    }
    match input.format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            println!("Created evidence export job {}", response.data.job.id);
            println!("status: {}", response.data.job.status);
            println!("artifact_count: {}", response.data.job.artifact_count);
            println!("row_count: {}", response.data.job.row_count);
            if let Some(completed_at) = response.data.job.completed_at {
                println!("completed_at: {completed_at}");
            }
        }
    }
    Ok(())
}

async fn run_webhooks(ctx: AppContext, command: WebhooksCommand) -> Result<()> {
    match command.command {
        WebhooksSubcommand::Create(input) => {
            let workspace = require_workspace(&ctx)?;
            let url = input.url.trim().to_string();
            let events: Vec<String> = input
                .events
                .into_iter()
                .map(|event| event.trim().to_string())
                .filter(|event| !event.is_empty())
                .collect();
            if url.is_empty() {
                bail!("webhook URL is required");
            }
            if events.is_empty() {
                bail!("at least one webhook event is required. Pass `--event receipt.issued`");
            }
            let mut body = serde_json::Map::new();
            body.insert("url".to_string(), json!(url));
            body.insert("events".to_string(), json!(events));
            if let Some(description) = input.description {
                body.insert("description".to_string(), json!(description));
            }
            let idempotency_key = webhook_idempotency_key(workspace, &body);
            let response = api_post::<WebhookEndpointResponse>(
                &ctx,
                &format!("/v1/tenants/{workspace}/webhook-endpoints"),
                serde_json::Value::Object(body),
                Some(idempotency_key),
            )
            .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => print_webhook_endpoint(&response.data),
            }
            Ok(())
        }
        WebhooksSubcommand::Deliveries(input) => {
            let workspace = require_workspace(&ctx)?;
            let response = api_get::<WebhookDeliveriesResponse>(
                &ctx,
                &format!("/v1/tenants/{workspace}/webhook-deliveries"),
            )
            .await?;
            match input.output {
                OutputFormat::Json => {
                    println!("{}", serde_json::to_string_pretty(&response)?);
                    Ok(())
                }
                OutputFormat::Text => {
                    if response.data.is_empty() {
                        println!("No webhook deliveries found.");
                        return Ok(());
                    }
                    println!("CREATED\tSTATUS\tEVENT\tATTEMPTS\tENDPOINT\tID");
                    for delivery in response.data {
                        println!(
                            "{}\t{}\t{}\t{}\t{}\t{}",
                            delivery.created_at,
                            delivery.status,
                            delivery.event_type,
                            delivery.attempts,
                            delivery.endpoint_id,
                            delivery.id
                        );
                    }
                    Ok(())
                }
            }
        }
        WebhooksSubcommand::Disable(input) => {
            let workspace = require_workspace(&ctx)?;
            api_delete(
                &ctx,
                &format!(
                    "/v1/tenants/{workspace}/webhook-endpoints/{}",
                    input.endpoint
                ),
            )
            .await?;
            println!("Disabled webhook endpoint {}", input.endpoint);
            Ok(())
        }
        WebhooksSubcommand::List(input) => {
            let workspace = require_workspace(&ctx)?;
            let response = api_get::<WebhookEndpointsResponse>(
                &ctx,
                &format!("/v1/tenants/{workspace}/webhook-endpoints"),
            )
            .await?;
            match input.output {
                OutputFormat::Json => {
                    println!("{}", serde_json::to_string_pretty(&response)?);
                    Ok(())
                }
                OutputFormat::Text => {
                    if response.data.is_empty() {
                        println!("No webhook endpoints found.");
                        return Ok(());
                    }
                    println!("CREATED\tSTATUS\tEVENTS\tURL\tID");
                    for endpoint in response.data {
                        let status = if endpoint.disabled_at.is_some() {
                            "disabled"
                        } else {
                            "active"
                        };
                        println!(
                            "{}\t{}\t{}\t{}\t{}",
                            endpoint.created_at,
                            status,
                            endpoint.events.join(","),
                            endpoint.url,
                            endpoint.id
                        );
                    }
                    Ok(())
                }
            }
        }
        WebhooksSubcommand::Test(input) => {
            let workspace = require_workspace(&ctx)?;
            let idempotency_key = webhook_test_idempotency_key(workspace, &input.endpoint);
            let response = api_post::<WebhookDeliveryResponse>(
                &ctx,
                &format!(
                    "/v1/tenants/{workspace}/webhook-endpoints/{}/test",
                    input.endpoint
                ),
                json!({}),
                Some(idempotency_key),
            )
            .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => {
                    println!("Queued webhook test delivery {}", response.data.id);
                    println!("status: {}", response.data.status);
                    println!("endpoint_id: {}", response.data.endpoint_id);
                }
            }
            Ok(())
        }
    }
}

async fn run_auth(ctx: AppContext, command: AuthCommand) -> Result<()> {
    match command.command {
        AuthSubcommand::Login(input) => {
            let email = input.email.trim().to_lowercase();
            if email.is_empty() {
                bail!("email is required");
            }
            if input.password.is_empty() {
                bail!("password is required");
            }
            let client = Client::new();
            let response = client
                .post(format!("{}/auth/login", ctx.api_url))
                .json(&json!({
                    "email": email,
                    "password": input.password,
                }))
                .send()
                .await
                .context("POST /auth/login failed")?;
            let status = response.status();
            let set_cookies = response
                .headers()
                .get_all(SET_COOKIE)
                .iter()
                .filter_map(|header| header.to_str().ok())
                .map(str::to_string)
                .collect::<Vec<_>>();
            let text = response
                .text()
                .await
                .context("could not read login response")?;
            if !status.is_success() {
                bail!("{}", format_api_error(status, &text));
            }
            let cookie = set_cookies
                .iter()
                .map(String::as_str)
                .find_map(extract_session_cookie)
                .ok_or_else(|| anyhow!("login succeeded without a session cookie"))?;

            let mut config = load_config()?;
            config.api_url = Some(ctx.api_url);
            config.session_cookie = Some(cookie);
            config.session_email = Some(email.clone());
            save_config(&config)?;
            println!("Signed in as {email}");
            println!("Saved admin session at {}", config_path()?.display());
            Ok(())
        }
        AuthSubcommand::Logout => {
            let mut config = load_config()?;
            config.session_cookie = None;
            config.session_email = None;
            save_config(&config)?;
            println!(
                "Removed saved admin session from {}",
                config_path()?.display()
            );
            Ok(())
        }
    }
}

async fn run_api_keys(ctx: AppContext, command: ApiKeysCommand) -> Result<()> {
    match command.command {
        ApiKeysSubcommand::Create(input) => {
            let workspace = require_workspace(&ctx)?;
            let response = create_workspace_api_key(
                &ctx,
                workspace,
                &input.name,
                input.scopes,
                input.expires_in,
            )
            .await?;
            if input.use_key {
                save_active_api_key(&ctx, workspace, &response.token)?;
            }

            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => {
                    print_created_api_key(&response);
                    if input.use_key {
                        println!("Saved token as the active CLI API key.");
                    } else {
                        println!("Token is shown once. Store it now or rerun with --use-key.");
                    }
                }
            }
            Ok(())
        }
        ApiKeysSubcommand::Rotate(input) => {
            let workspace = require_workspace(&ctx)?;
            let replacement_name = input
                .name
                .unwrap_or_else(|| format!("Rotation replacement for {}", input.id));
            let response = create_workspace_api_key(
                &ctx,
                workspace,
                &replacement_name,
                input.scopes,
                input.expires_in,
            )
            .await?;
            session_delete(&ctx, &format!("/tenants/{workspace}/api-keys/{}", input.id)).await?;

            if input.use_key {
                save_active_api_key(&ctx, workspace, &response.token)?;
            }

            match input.output {
                OutputFormat::Json => {
                    let body = ApiKeyRotateResponse {
                        api_key: response.api_key,
                        token: response.token,
                        revoked_api_key_id: input.id,
                    };
                    println!("{}", serde_json::to_string_pretty(&body)?);
                }
                OutputFormat::Text => {
                    println!("Rotated API key {}", input.id);
                    print_created_api_key(&response);
                    println!("revoked: {}", input.id);
                    if input.use_key {
                        println!("Saved replacement token as the active CLI API key.");
                    } else {
                        println!(
                            "Replacement token is shown once. Store it now or rerun with --use-key."
                        );
                    }
                }
            }
            Ok(())
        }
        ApiKeysSubcommand::List(input) => {
            let workspace = require_workspace(&ctx)?;
            let response =
                session_get::<ApiKeysResponse>(&ctx, &format!("/tenants/{workspace}/api-keys"))
                    .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => {
                    if response.api_keys.is_empty() {
                        println!("No API keys found.");
                        return Ok(());
                    }
                    println!(
                        "CREATED\tSTATUS\tEXPIRES\tUSES\tLAST_USED\tWORKSPACE\tSCOPES\tPREFIX\tNAME\tID"
                    );
                    for key in response.api_keys {
                        let status = if key.revoked_at.is_some() {
                            "revoked"
                        } else {
                            "active"
                        };
                        let workspace = key
                            .workspace
                            .as_ref()
                            .map(|workspace| format!("{} ({})", workspace.name, workspace.slug))
                            .unwrap_or_else(|| workspace.to_string());
                        let last_used = format_api_key_last_used(&key);
                        println!(
                            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                            key.created_at,
                            status,
                            key.expires_at.as_deref().unwrap_or("never"),
                            key.usage_count.unwrap_or(0),
                            last_used,
                            workspace,
                            key.scopes.join(","),
                            key.key_prefix,
                            key.name,
                            key.id
                        );
                    }
                }
            }
            Ok(())
        }
        ApiKeysSubcommand::Revoke(input) => {
            let workspace = require_workspace(&ctx)?;
            session_delete(&ctx, &format!("/tenants/{workspace}/api-keys/{}", input.id)).await?;
            println!("Revoked API key {}", input.id);
            Ok(())
        }
    }
}

async fn create_workspace_api_key(
    ctx: &AppContext,
    workspace: &str,
    name: &str,
    scopes: Vec<String>,
    expires_in: Option<String>,
) -> Result<ApiKeyCreateResponse> {
    let name = name.trim();
    if name.is_empty() {
        bail!("API key name is required");
    }
    let scopes = normalize_api_key_scopes(scopes)?;
    let expires_at = expires_in
        .as_deref()
        .map(api_key_expiration_from_duration)
        .transpose()?;
    let payload = match &expires_at {
        Some(expires_at) => json!({
            "name": name,
            "scopes": scopes,
            "expiresAt": expires_at,
        }),
        None => json!({
            "name": name,
            "scopes": scopes,
        }),
    };
    session_post::<ApiKeyCreateResponse>(ctx, &format!("/tenants/{workspace}/api-keys"), payload)
        .await
}

fn save_active_api_key(ctx: &AppContext, workspace: &str, token: &str) -> Result<()> {
    let mut config = load_config()?;
    config.api_url = Some(ctx.api_url.clone());
    config.workspace = Some(workspace.to_string());
    config.api_key = Some(token.to_string());
    save_config(&config)
}

fn print_created_api_key(response: &ApiKeyCreateResponse) {
    println!("Created API key {}", response.api_key.id);
    println!("name: {}", response.api_key.name);
    if let Some(workspace) = &response.api_key.workspace {
        println!("workspace: {} ({})", workspace.name, workspace.slug);
    }
    println!("prefix: {}", response.api_key.key_prefix);
    println!("scopes: {}", response.api_key.scopes.join(","));
    println!(
        "expires: {}",
        response.api_key.expires_at.as_deref().unwrap_or("never")
    );
    println!("token: {}", response.token);
}

fn format_api_key_last_used(key: &ApiKeyRecord) -> String {
    match &key.last_used_at {
        Some(last_used_at) => {
            let method = key.last_used_method.as_deref().unwrap_or("UNKNOWN");
            let path = key.last_used_path.as_deref().unwrap_or("unknown");
            let status = key
                .last_used_status_code
                .map(|status| status.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            format!("{last_used_at} {method} {path} {status}")
        }
        None => "never".to_string(),
    }
}

fn print_webhook_endpoint(endpoint: &WebhookEndpoint) {
    println!("Webhook endpoint: {}", endpoint.id);
    println!("url: {}", endpoint.url);
    println!("events: {}", endpoint.events.join(","));
    println!("created_at: {}", endpoint.created_at);
    if let Some(description) = &endpoint.description {
        println!("description: {description}");
    }
    if let Some(disabled_at) = &endpoint.disabled_at {
        println!("disabled_at: {disabled_at}");
    }
    if let Some(secret) = &endpoint.signing_secret {
        println!("signing_secret: {secret}");
    }
}

async fn run_config(command: ConfigCommand) -> Result<()> {
    match command.command {
        ConfigSubcommand::Set(input) => {
            let mut config = load_config()?;
            if input.api_url.is_some() {
                config.api_url = input.api_url;
            }
            if input.api_key.is_some() {
                config.api_key = input.api_key;
            }
            if input.workspace.is_some() {
                config.workspace = input.workspace;
            }
            save_config(&config)?;
            println!("Saved Proveria CLI config at {}", config_path()?.display());
            Ok(())
        }
        ConfigSubcommand::Show => {
            let config = load_config()?;
            println!("{}", serde_json::to_string_pretty(&config)?);
            Ok(())
        }
    }
}

fn run_hash(command: HashCommand) -> Result<()> {
    let hash = sha256_file(&command.file)?;
    match command.output {
        OutputFormat::Text => println!("{hash}  {}", command.file.display()),
        OutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "file": command.file,
                    "sha256": hash,
                }))?
            );
        }
    }
    Ok(())
}

async fn run_projects(ctx: AppContext, command: ProjectsCommand) -> Result<()> {
    match command.command {
        ProjectsSubcommand::Create(input) => {
            let workspace = require_workspace(&ctx)?;
            let slug = input.slug.trim().to_string();
            let name = input.name.trim().to_string();
            if slug.is_empty() {
                bail!("project slug is required");
            }
            if name.is_empty() {
                bail!("project name is required");
            }
            let mut body = serde_json::Map::new();
            body.insert("slug".to_string(), json!(slug));
            body.insert("name".to_string(), json!(name));
            if let Some(description) = input.description {
                body.insert("description".to_string(), json!(description));
            }
            if let Some(classification) = input.classification {
                body.insert("classification".to_string(), json!(classification));
            }
            if !input.tags.is_empty() {
                body.insert("tags".to_string(), json!(input.tags));
            }
            if let Some(visibility) = input.visibility {
                body.insert(
                    "visibility".to_string(),
                    json!(match visibility {
                        ProjectVisibility::Public => "public",
                        ProjectVisibility::Private => "private",
                    }),
                );
            }
            let body = serde_json::Value::Object(body);
            let idempotency_key = project_idempotency_key(workspace, &input.slug, &input.name);
            let response = api_post::<ProjectResponse>(
                &ctx,
                &format!("/v1/tenants/{workspace}/projects"),
                body,
                Some(idempotency_key),
            )
            .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => {
                    println!("Created project {}", response.data.slug);
                    println!("name: {}", response.data.name);
                    println!("id: {}", response.data.id);
                }
            }
            Ok(())
        }
        ProjectsSubcommand::List => {
            let workspace = require_workspace(&ctx)?;
            let response =
                api_get::<ProjectsResponse>(&ctx, &format!("/v1/tenants/{workspace}/projects"))
                    .await?;
            if response.data.is_empty() {
                println!("No projects found.");
                return Ok(());
            }
            for project in response.data {
                println!("{}\t{}\t{}", project.slug, project.name, project.id);
            }
            Ok(())
        }
    }
}

async fn run_records(ctx: AppContext, command: RecordsCommand) -> Result<()> {
    match command.command {
        RecordsSubcommand::Get(input) => {
            let workspace = require_workspace(&ctx)?;
            let response = api_get::<AttestationResponse>(
                &ctx,
                &format!("/v1/tenants/{workspace}/attestations/{}", input.attestation),
            )
            .await?;
            match input.output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
                OutputFormat::Text => print_attestation_record(&response.data),
            }
            Ok(())
        }
    }
}

fn print_attestation_record(attestation: &Attestation) {
    println!("Record: {}", attestation.label);
    println!("id: {}", attestation.id);
    println!("state: {}", attestation.state);
    if let Some(project) = &attestation.project {
        println!("project: {} ({})", project.name, project.slug);
    }
    if let Some(package_id) = &attestation.package_id {
        println!("package_id: {package_id}");
    }
    if let Some(merkle_root) = &attestation.merkle_root {
        println!("merkle_root: {merkle_root}");
    }
    println!(
        "receipt: {}",
        if attestation.receipt_available {
            "available"
        } else {
            "not available"
        }
    );
    println!("created_at: {}", attestation.created_at);
    if let Some(confirmed_at) = &attestation.confirmed_at {
        println!("confirmed_at: {confirmed_at}");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetInventorySourceMetadata {
    provider: &'static str,
    record_type: String,
    schema_version: String,
    canonical_hash: String,
    dataset_name: String,
    dataset_version: String,
    inventory_scope: String,
    file_count: u64,
    total_bytes: u64,
    dataset_root_hash: String,
    data_classification: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    license_usage_basis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retention_rule: Option<String>,
}

#[derive(Debug)]
struct DatasetInventoryRecordPackage {
    record: serde_json::Value,
    canonical_json: String,
    canonical_hash: String,
    metadata: DatasetInventorySourceMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetRevisionSourceMetadata {
    provider: &'static str,
    record_type: String,
    schema_version: String,
    canonical_hash: String,
    dataset_name: String,
    previous_dataset_version: String,
    next_dataset_version: String,
    previous_dataset_root_hash: String,
    next_dataset_root_hash: String,
    revision_root_hash: String,
    new_file_count: u64,
    changed_file_count: u64,
    removed_file_count: u64,
    unchanged_file_count: u64,
}

#[derive(Debug)]
enum DatasetRecordMetadata {
    Inventory(DatasetInventorySourceMetadata),
    Revision(DatasetRevisionSourceMetadata),
}

#[derive(Debug)]
struct DatasetRecordPackage {
    canonical_json: String,
    canonical_hash: String,
    metadata: DatasetRecordMetadata,
}

#[derive(Debug)]
struct DatasetRevisionRecordPackage {
    canonical_json: String,
    canonical_hash: String,
    metadata: DatasetRevisionSourceMetadata,
}

async fn run_dataset(ctx: AppContext, command: DatasetCommand) -> Result<()> {
    match command.command {
        DatasetSubcommand::Init(input) => run_dataset_init(input),
        DatasetSubcommand::Collect(input) => run_dataset_collect(input),
        DatasetSubcommand::Revision(input) => run_dataset_revision(input),
        DatasetSubcommand::Inspect(input) => run_dataset_inspect(input),
        DatasetSubcommand::Attest(input) => run_dataset_attest(ctx, input).await,
    }
}

fn run_dataset_init(input: DatasetInit) -> Result<()> {
    if input.output.exists() {
        bail!(
            "{} already exists. Remove it or choose a different --output path.",
            input.output.display()
        );
    }
    let template = dataset_inventory_template();
    let body = serde_json::to_string_pretty(&template)?;
    fs::write(&input.output, format!("{body}\n"))
        .with_context(|| format!("could not write {}", input.output.display()))?;
    println!("Wrote {}", input.output.display());
    println!("Edit the dataset inventory details, then run:");
    println!(
        "proveria dataset attest {} --project <project-slug>",
        input.output.display()
    );
    Ok(())
}

fn run_dataset_collect(input: DatasetCollect) -> Result<()> {
    if input.output.exists() {
        bail!(
            "{} already exists. Remove it or choose a different --output path.",
            input.output.display()
        );
    }
    let record = collect_dataset_inventory(&input)?;
    let body = serde_json::to_string_pretty(&record)?;
    fs::write(&input.output, format!("{body}\n"))
        .with_context(|| format!("could not write {}", input.output.display()))?;
    let package = dataset_inventory_package(&record)?;
    println!("Wrote {}", input.output.display());
    println!("files: {}", package.metadata.file_count);
    println!("total_bytes: {}", package.metadata.total_bytes);
    println!("dataset_root_hash: {}", package.metadata.dataset_root_hash);
    println!("canonical_hash: {}", package.canonical_hash);
    Ok(())
}

fn run_dataset_revision(input: DatasetRevision) -> Result<()> {
    if input.output.exists() {
        bail!(
            "{} already exists. Remove it or choose a different --output path.",
            input.output.display()
        );
    }
    let base = read_dataset_inventory_record(&input.base)?;
    let next = read_dataset_inventory_record(&input.next)?;
    let record = build_dataset_revision_record(&base.record, &next.record)?;
    let body = serde_json::to_string_pretty(&record)?;
    fs::write(&input.output, format!("{body}\n"))
        .with_context(|| format!("could not write {}", input.output.display()))?;
    let package = dataset_revision_package(&record)?;
    println!("Wrote {}", input.output.display());
    println!(
        "dataset: {} {} -> {}",
        package.metadata.dataset_name,
        package.metadata.previous_dataset_version,
        package.metadata.next_dataset_version
    );
    println!("new_files: {}", package.metadata.new_file_count);
    println!("changed_files: {}", package.metadata.changed_file_count);
    println!("removed_files: {}", package.metadata.removed_file_count);
    println!("unchanged_files: {}", package.metadata.unchanged_file_count);
    println!(
        "revision_root_hash: {}",
        package.metadata.revision_root_hash
    );
    println!("canonical_hash: {}", package.canonical_hash);
    Ok(())
}

fn run_dataset_inspect(input: DatasetInspect) -> Result<()> {
    let package = read_dataset_record(&input.file)?;
    match input.output {
        OutputFormat::Text => match &package.metadata {
            DatasetRecordMetadata::Inventory(metadata) => {
                println!("record_type: {}", metadata.record_type);
                println!("schema_version: {}", metadata.schema_version);
                println!(
                    "dataset: {} {}",
                    metadata.dataset_name, metadata.dataset_version
                );
                println!("files: {}", metadata.file_count);
                println!("total_bytes: {}", metadata.total_bytes);
                println!("dataset_root_hash: {}", metadata.dataset_root_hash);
                println!("canonical_hash: {}", package.canonical_hash);
                println!("canonical_bytes: {}", package.canonical_json.len());
            }
            DatasetRecordMetadata::Revision(metadata) => {
                println!("record_type: {}", metadata.record_type);
                println!("schema_version: {}", metadata.schema_version);
                println!(
                    "dataset: {} {} -> {}",
                    metadata.dataset_name,
                    metadata.previous_dataset_version,
                    metadata.next_dataset_version
                );
                println!("new_files: {}", metadata.new_file_count);
                println!("changed_files: {}", metadata.changed_file_count);
                println!("removed_files: {}", metadata.removed_file_count);
                println!("unchanged_files: {}", metadata.unchanged_file_count);
                println!(
                    "previous_dataset_root_hash: {}",
                    metadata.previous_dataset_root_hash
                );
                println!(
                    "next_dataset_root_hash: {}",
                    metadata.next_dataset_root_hash
                );
                println!("revision_root_hash: {}", metadata.revision_root_hash);
                println!("canonical_hash: {}", package.canonical_hash);
                println!("canonical_bytes: {}", package.canonical_json.len());
            }
        },
        OutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "canonicalHash": package.canonical_hash,
                    "canonicalBytes": package.canonical_json.len(),
                    "sourceMetadata": source_metadata_json(&package.metadata)?,
                }))?
            );
        }
    }
    Ok(())
}

async fn run_dataset_attest(ctx: AppContext, input: DatasetAttest) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let package = read_dataset_record(&input.file)?;
    let file_name = input
        .file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("dataset record file name is not valid UTF-8"))?
        .to_string();
    let label = input
        .name
        .unwrap_or_else(|| default_dataset_label(&package.metadata));

    let mut body = serde_json::Map::new();
    body.insert("label".to_string(), json!(label));
    body.insert("sha256".to_string(), json!(package.canonical_hash));
    body.insert("fileName".to_string(), json!(file_name));
    body.insert(
        "byteSize".to_string(),
        json!(package.canonical_json.len() as u64),
    );
    body.insert(
        "sourceMetadata".to_string(),
        source_metadata_json(&package.metadata)?,
    );

    let idempotency_key = attestation_idempotency_key(
        workspace,
        &input.project,
        body.get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("dataset-inventory"),
        body.get("fileName")
            .and_then(|value| value.as_str())
            .unwrap_or("dataset-record.json"),
        body.get("sha256")
            .and_then(|value| value.as_str())
            .unwrap_or_default(),
        None,
    );
    let response = api_post::<CreateAttestationResponse>(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/projects/{}/attestations",
            input.project
        ),
        serde_json::Value::Object(body),
        Some(idempotency_key),
    )
    .await?;
    match input.output {
        OutputFormat::Text => {
            println!("Submitted dataset receipt");
            println!("canonical_hash: {}", package.canonical_hash);
            println!("{}", serde_json::to_string_pretty(&response.data)?);
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
    }
    Ok(())
}

fn read_dataset_inventory_record(path: &Path) -> Result<DatasetInventoryRecordPackage> {
    let text =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("could not parse {}", path.display()))?;
    if !parsed.is_object() {
        bail!("dataset inventory record must be a JSON object");
    }
    dataset_inventory_package(&parsed)
}

fn read_dataset_record(path: &Path) -> Result<DatasetRecordPackage> {
    let text =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("could not parse {}", path.display()))?;
    if !parsed.is_object() {
        bail!("dataset record must be a JSON object");
    }
    match parsed.get("record_type").and_then(|value| value.as_str()) {
        Some("dataset_inventory_record") => {
            let package = dataset_inventory_package(&parsed)?;
            Ok(DatasetRecordPackage {
                canonical_json: package.canonical_json,
                canonical_hash: package.canonical_hash,
                metadata: DatasetRecordMetadata::Inventory(package.metadata),
            })
        }
        Some("dataset_revision_record") => {
            let package = dataset_revision_package(&parsed)?;
            Ok(DatasetRecordPackage {
                canonical_json: package.canonical_json,
                canonical_hash: package.canonical_hash,
                metadata: DatasetRecordMetadata::Revision(package.metadata),
            })
        }
        _ => bail!("record_type must be dataset_inventory_record or dataset_revision_record"),
    }
}

fn dataset_inventory_package(record: &serde_json::Value) -> Result<DatasetInventoryRecordPackage> {
    let canonical = canonical_json(record);
    let canonical_hash = hex::encode(Sha256::digest(canonical.as_bytes()));
    let metadata = dataset_inventory_metadata(record, canonical_hash.clone())?;
    Ok(DatasetInventoryRecordPackage {
        record: record.clone(),
        canonical_json: canonical,
        canonical_hash,
        metadata,
    })
}

fn dataset_revision_package(record: &serde_json::Value) -> Result<DatasetRevisionRecordPackage> {
    let canonical = canonical_json(record);
    let canonical_hash = hex::encode(Sha256::digest(canonical.as_bytes()));
    let metadata = dataset_revision_metadata(record, canonical_hash.clone())?;
    Ok(DatasetRevisionRecordPackage {
        canonical_json: canonical,
        canonical_hash,
        metadata,
    })
}

fn dataset_inventory_metadata(
    record: &serde_json::Value,
    canonical_hash: String,
) -> Result<DatasetInventorySourceMetadata> {
    let record_type = required_string(record, &["record_type"])?;
    if record_type != "dataset_inventory_record" {
        bail!("record_type must be dataset_inventory_record");
    }
    Ok(DatasetInventorySourceMetadata {
        provider: "dataset_inventory",
        record_type,
        schema_version: required_string(record, &["schema_version"])?,
        canonical_hash,
        dataset_name: required_string(record, &["dataset", "name"])?,
        dataset_version: required_string(record, &["dataset", "version"])?,
        inventory_scope: required_string(record, &["dataset", "inventory_scope"])?,
        file_count: required_u64(record, &["summary", "file_count"])?,
        total_bytes: required_u64(record, &["summary", "total_bytes"])?,
        dataset_root_hash: required_sha256(record, &["summary", "dataset_root_hash"])?,
        data_classification: required_string(record, &["dataset", "data_classification"])?,
        source_owner: optional_string(record, &["dataset", "source_owner"])?,
        license_usage_basis: optional_string(record, &["dataset", "license_usage_basis"])?,
        retention_rule: optional_string(record, &["dataset", "retention_rule"])?,
    })
}

fn dataset_revision_metadata(
    record: &serde_json::Value,
    canonical_hash: String,
) -> Result<DatasetRevisionSourceMetadata> {
    let record_type = required_string(record, &["record_type"])?;
    if record_type != "dataset_revision_record" {
        bail!("record_type must be dataset_revision_record");
    }
    Ok(DatasetRevisionSourceMetadata {
        provider: "dataset_revision",
        record_type,
        schema_version: required_string(record, &["schema_version"])?,
        canonical_hash,
        dataset_name: required_string(record, &["dataset", "name"])?,
        previous_dataset_version: required_string(record, &["dataset", "previous_version"])?,
        next_dataset_version: required_string(record, &["dataset", "next_version"])?,
        previous_dataset_root_hash: required_sha256(
            record,
            &["summary", "previous_dataset_root_hash"],
        )?,
        next_dataset_root_hash: required_sha256(record, &["summary", "next_dataset_root_hash"])?,
        revision_root_hash: required_sha256(record, &["summary", "revision_root_hash"])?,
        new_file_count: required_u64(record, &["summary", "new_file_count"])?,
        changed_file_count: required_u64(record, &["summary", "changed_file_count"])?,
        removed_file_count: required_u64(record, &["summary", "removed_file_count"])?,
        unchanged_file_count: required_u64(record, &["summary", "unchanged_file_count"])?,
    })
}

fn source_metadata_json(metadata: &DatasetRecordMetadata) -> Result<serde_json::Value> {
    match metadata {
        DatasetRecordMetadata::Inventory(metadata) => Ok(serde_json::to_value(metadata)?),
        DatasetRecordMetadata::Revision(metadata) => Ok(serde_json::to_value(metadata)?),
    }
}

fn default_dataset_label(metadata: &DatasetRecordMetadata) -> String {
    match metadata {
        DatasetRecordMetadata::Inventory(metadata) => {
            format!(
                "{} {} inventory",
                metadata.dataset_name, metadata.dataset_version
            )
        }
        DatasetRecordMetadata::Revision(metadata) => format!(
            "{} {} to {} revision",
            metadata.dataset_name, metadata.previous_dataset_version, metadata.next_dataset_version
        ),
    }
}

fn build_dataset_revision_record(
    base: &serde_json::Value,
    next: &serde_json::Value,
) -> Result<serde_json::Value> {
    let base_meta = dataset_inventory_metadata(base, sample_hash("base-inventory"))?;
    let next_meta = dataset_inventory_metadata(next, sample_hash("next-inventory"))?;
    if base_meta.dataset_name != next_meta.dataset_name {
        bail!("dataset.name must match between base and next inventory records");
    }

    let base_files = dataset_file_map(base)?;
    let next_files = dataset_file_map(next)?;
    let mut new_files = Vec::new();
    let mut changed_files = Vec::new();
    let mut removed_files = Vec::new();
    let mut unchanged_files = Vec::new();

    for (path, next_file) in &next_files {
        match base_files.get(path) {
            None => new_files.push(json!({
                "path": path,
                "sha256": next_file.sha256,
                "byte_size": next_file.byte_size,
            })),
            Some(base_file) if base_file.sha256 != next_file.sha256 => changed_files.push(json!({
                "path": path,
                "previous_sha256": base_file.sha256,
                "next_sha256": next_file.sha256,
                "previous_byte_size": base_file.byte_size,
                "next_byte_size": next_file.byte_size,
            })),
            Some(_) => unchanged_files.push(json!({
                "path": path,
                "sha256": next_file.sha256,
                "byte_size": next_file.byte_size,
            })),
        }
    }
    for (path, base_file) in &base_files {
        if !next_files.contains_key(path) {
            removed_files.push(json!({
                "path": path,
                "sha256": base_file.sha256,
                "byte_size": base_file.byte_size,
            }));
        }
    }

    let changes = json!({
        "new": new_files,
        "changed": changed_files,
        "removed": removed_files,
        "unchanged": unchanged_files,
    });
    let revision_root_hash = hex::encode(Sha256::digest(canonical_json(&changes).as_bytes()));

    Ok(json!({
        "record_type": "dataset_revision_record",
        "schema_version": "0.1",
        "dataset": {
            "name": base_meta.dataset_name,
            "previous_version": base_meta.dataset_version,
            "next_version": next_meta.dataset_version,
        },
        "summary": {
            "new_file_count": changes["new"].as_array().map(Vec::len).unwrap_or(0) as u64,
            "changed_file_count": changes["changed"].as_array().map(Vec::len).unwrap_or(0) as u64,
            "removed_file_count": changes["removed"].as_array().map(Vec::len).unwrap_or(0) as u64,
            "unchanged_file_count": changes["unchanged"].as_array().map(Vec::len).unwrap_or(0) as u64,
            "previous_dataset_root_hash": base_meta.dataset_root_hash,
            "next_dataset_root_hash": next_meta.dataset_root_hash,
            "revision_root_hash": revision_root_hash,
            "hash_algorithm": "sha256",
        },
        "changes": changes,
        "privacy": {
            "raw_files_uploaded_to_proveria": false,
            "stored_by_proveria": ["canonical revision hash", "path-level change hashes if revision record is submitted separately"],
            "local_only": ["raw dataset file bytes"]
        }
    }))
}

#[derive(Debug)]
struct DatasetFileEntry {
    sha256: String,
    byte_size: u64,
}

fn dataset_file_map(record: &serde_json::Value) -> Result<BTreeMap<String, DatasetFileEntry>> {
    let files = record
        .get("files")
        .and_then(|value| value.as_array())
        .ok_or_else(|| anyhow!("dataset inventory record must include a files array"))?;
    let mut map = BTreeMap::new();
    for file in files {
        let path = required_string(file, &["path"])?;
        if map.contains_key(&path) {
            bail!("dataset inventory record contains duplicate file path {path}");
        }
        map.insert(
            path,
            DatasetFileEntry {
                sha256: required_sha256(file, &["sha256"])?,
                byte_size: required_u64(file, &["byte_size"])?,
            },
        );
    }
    Ok(map)
}

fn collect_dataset_inventory(input: &DatasetCollect) -> Result<serde_json::Value> {
    if !input.input.is_dir() {
        bail!("{} is not a directory", input.input.display());
    }
    let mut files = Vec::new();
    collect_dataset_files(&input.input, &input.input, &mut files)?;
    files.sort_by(|a, b| {
        a.get("path")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .cmp(
                b.get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default(),
            )
    });
    let file_count = files.len() as u64;
    let total_bytes = files
        .iter()
        .filter_map(|file| file.get("byte_size").and_then(|value| value.as_u64()))
        .sum::<u64>();
    let dataset_root_hash = hex::encode(Sha256::digest(canonical_json(&json!(files)).as_bytes()));
    Ok(json!({
        "record_type": "dataset_inventory_record",
        "schema_version": "0.1",
        "dataset": {
            "name": input.name,
            "version": input.version,
            "description": "",
            "inventory_scope": input.scope,
            "source_owner": input.source_owner.clone().unwrap_or_default(),
            "license_usage_basis": input.license_usage_basis.clone().unwrap_or_default(),
            "data_classification": input.classification,
            "retention_rule": input.retention_rule.clone().unwrap_or_default(),
        },
        "summary": {
            "file_count": file_count,
            "total_bytes": total_bytes,
            "dataset_root_hash": dataset_root_hash,
            "hash_algorithm": "sha256",
        },
        "files": files,
        "privacy": {
            "raw_files_uploaded_to_proveria": false,
            "stored_by_proveria": ["canonical inventory hash", "file hashes", "file paths in inventory record if submitted separately"],
            "local_only": ["raw dataset file bytes"]
        }
    }))
}

fn collect_dataset_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<serde_json::Value>,
) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("could not read {}", dir.display()))? {
        let entry = entry.with_context(|| format!("could not read entry in {}", dir.display()))?;
        let path = entry.path();
        let metadata =
            fs::metadata(&path).with_context(|| format!("could not stat {}", path.display()))?;
        if metadata.is_dir() {
            collect_dataset_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.push(json!({
                "path": relative,
                "sha256": sha256_file(&path)?,
                "byte_size": metadata.len(),
            }));
        }
    }
    Ok(())
}

fn required_u64(record: &serde_json::Value, path: &[&str]) -> Result<u64> {
    value_at_path(record, path)
        .and_then(|value| value.as_u64())
        .ok_or_else(|| anyhow!("missing required unsigned integer field {}", path.join(".")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelReleaseSourceMetadata {
    provider: &'static str,
    record_type: String,
    schema_version: String,
    canonical_hash: String,
    model_name: String,
    model_version: String,
    model_type: String,
    release_stage: String,
    claim_type: String,
    claim_text: String,
    claim_scope: String,
    subject_type: String,
    subject_identifier: String,
    subject_hash: String,
    artifact_manifest_hash: String,
    model_card_hash: String,
    dataset_manifest_hash: String,
    evaluation_report_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    risk_review_hash: Option<String>,
    policy_id: String,
    policy_version: String,
    policy_decision: String,
    final_approver: String,
    final_approval_timestamp: String,
    disclosure_mode: String,
    verification_policy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retention_period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    known_limitations: Option<String>,
}

#[derive(Debug)]
struct ModelReleaseRecordPackage {
    canonical_json: String,
    canonical_hash: String,
    metadata: ModelReleaseSourceMetadata,
}

async fn run_model_release(ctx: AppContext, command: ModelReleaseCommand) -> Result<()> {
    match command.command {
        ModelReleaseSubcommand::Init(input) => run_model_release_init(input),
        ModelReleaseSubcommand::Inspect(input) => run_model_release_inspect(input),
        ModelReleaseSubcommand::Attest(input) => run_model_release_attest(ctx, input).await,
    }
}

fn run_model_release_init(input: ModelReleaseInit) -> Result<()> {
    if input.output.exists() {
        bail!(
            "{} already exists. Remove it or choose a different --output path.",
            input.output.display()
        );
    }
    let template = model_release_template();
    let body = serde_json::to_string_pretty(&template)?;
    fs::write(&input.output, format!("{body}\n"))
        .with_context(|| format!("could not write {}", input.output.display()))?;
    println!("Wrote {}", input.output.display());
    println!("Edit the model release details, then run:");
    println!(
        "proveria model-release attest {} --project <project-slug>",
        input.output.display()
    );
    Ok(())
}

fn run_model_release_inspect(input: ModelReleaseInspect) -> Result<()> {
    let package = read_model_release_record(&input.file)?;
    match input.output {
        OutputFormat::Text => {
            println!("record_type: {}", package.metadata.record_type);
            println!("schema_version: {}", package.metadata.schema_version);
            println!(
                "model: {} {}",
                package.metadata.model_name, package.metadata.model_version
            );
            println!("claim_type: {}", package.metadata.claim_type);
            println!("subject_hash: {}", package.metadata.subject_hash);
            println!("canonical_hash: {}", package.canonical_hash);
            println!("canonical_bytes: {}", package.canonical_json.len());
        }
        OutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "canonicalHash": package.canonical_hash,
                    "canonicalBytes": package.canonical_json.len(),
                    "sourceMetadata": package.metadata,
                }))?
            );
        }
    }
    Ok(())
}

async fn run_model_release_attest(ctx: AppContext, input: ModelReleaseAttest) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    let package = read_model_release_record(&input.file)?;
    let file_name = input
        .file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("model release file name is not valid UTF-8"))?
        .to_string();
    let label = input.name.unwrap_or_else(|| {
        format!(
            "{} {} release",
            package.metadata.model_name, package.metadata.model_version
        )
    });

    let mut body = serde_json::Map::new();
    body.insert("label".to_string(), json!(label));
    body.insert("sha256".to_string(), json!(package.canonical_hash));
    body.insert("fileName".to_string(), json!(file_name));
    body.insert(
        "byteSize".to_string(),
        json!(package.canonical_json.len() as u64),
    );
    body.insert(
        "sourceMetadata".to_string(),
        serde_json::to_value(&package.metadata)?,
    );

    let idempotency_key = attestation_idempotency_key(
        workspace,
        &input.project,
        body.get("label")
            .and_then(|value| value.as_str())
            .unwrap_or("model-release"),
        body.get("fileName")
            .and_then(|value| value.as_str())
            .unwrap_or("model-release.json"),
        body.get("sha256")
            .and_then(|value| value.as_str())
            .unwrap_or_default(),
        None,
    );
    let response = api_post::<CreateAttestationResponse>(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/projects/{}/attestations",
            input.project
        ),
        serde_json::Value::Object(body),
        Some(idempotency_key),
    )
    .await?;
    match input.output {
        OutputFormat::Text => {
            println!("Submitted model release receipt");
            println!("canonical_hash: {}", package.canonical_hash);
            println!("{}", serde_json::to_string_pretty(&response.data)?);
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
    }
    Ok(())
}

fn read_model_release_record(path: &Path) -> Result<ModelReleaseRecordPackage> {
    let text =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("could not parse {}", path.display()))?;
    if !parsed.is_object() {
        bail!("model release record must be a JSON object");
    }
    let canonical = canonical_json(&parsed);
    let canonical_hash = hex::encode(Sha256::digest(canonical.as_bytes()));
    let metadata = model_release_metadata(&parsed, canonical_hash.clone())?;
    Ok(ModelReleaseRecordPackage {
        canonical_json: canonical,
        canonical_hash,
        metadata,
    })
}

fn model_release_metadata(
    record: &serde_json::Value,
    canonical_hash: String,
) -> Result<ModelReleaseSourceMetadata> {
    let record_type = required_string(record, &["record_type"])?;
    if record_type != "model_provenance_record" {
        bail!("record_type must be model_provenance_record");
    }
    Ok(ModelReleaseSourceMetadata {
        provider: "model_release",
        record_type,
        schema_version: required_string(record, &["schema_version"])?,
        canonical_hash,
        model_name: required_string(record, &["model", "name"])?,
        model_version: required_string(record, &["model", "version"])?,
        model_type: required_string(record, &["model", "type"])?,
        release_stage: required_string(record, &["model", "release_stage"])?,
        claim_type: required_string(record, &["claim", "claim_type"])?,
        claim_text: required_string(record, &["claim", "claim_text"])?,
        claim_scope: required_string(record, &["claim", "claim_scope"])?,
        subject_type: required_string(record, &["claim", "subject_type"])?,
        subject_identifier: required_string(record, &["claim", "subject_identifier"])?,
        subject_hash: required_sha256(record, &["claim", "subject_hash"])?,
        artifact_manifest_hash: required_sha256(record, &["artifacts", "artifact_manifest_hash"])?,
        model_card_hash: required_sha256(record, &["artifacts", "model_card_hash"])?,
        dataset_manifest_hash: required_sha256(
            record,
            &["data_provenance", "dataset_manifest_hash"],
        )?,
        evaluation_report_hash: required_sha256(record, &["evaluation", "evaluation_report_hash"])?,
        risk_review_hash: optional_sha256(record, &["evaluation", "risk_review_hash"])?,
        policy_id: required_string(record, &["policy", "policy_id"])?,
        policy_version: required_string(record, &["policy", "policy_version"])?,
        policy_decision: required_string(record, &["policy", "policy_decision"])?,
        final_approver: required_string(record, &["approval", "final_approver"])?,
        final_approval_timestamp: required_string(
            record,
            &["approval", "final_approval_timestamp"],
        )?,
        disclosure_mode: required_string(record, &["disclosure", "disclosure_mode"])?,
        verification_policy: required_string(record, &["disclosure", "verification_policy"])?,
        retention_period: optional_string(record, &["disclosure", "retention_period"])?,
        known_limitations: optional_string(record, &["evaluation", "known_limitations"])?,
    })
}

fn required_string(record: &serde_json::Value, path: &[&str]) -> Result<String> {
    let value = value_at_path(record, path)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("missing required string field {}", path.join(".")))?;
    Ok(value.to_string())
}

fn optional_string(record: &serde_json::Value, path: &[&str]) -> Result<Option<String>> {
    let Some(value) = value_at_path(record, path) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let value = value
        .as_str()
        .ok_or_else(|| anyhow!("{} must be a string", path.join(".")))?
        .trim();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value.to_string()))
    }
}

fn required_sha256(record: &serde_json::Value, path: &[&str]) -> Result<String> {
    let value = required_string(record, path)?;
    normalized_sha256(&value)
        .with_context(|| format!("{} must be a SHA-256 hex string", path.join(".")))
}

fn optional_sha256(record: &serde_json::Value, path: &[&str]) -> Result<Option<String>> {
    let Some(value) = optional_string(record, path)? else {
        return Ok(None);
    };
    normalized_sha256(&value)
        .map(Some)
        .with_context(|| format!("{} must be a SHA-256 hex string", path.join(".")))
}

fn value_at_path<'a>(
    record: &'a serde_json::Value,
    path: &[&str],
) -> Option<&'a serde_json::Value> {
    let mut current = record;
    for segment in path {
        current = current.get(*segment)?;
    }
    Some(current)
}

async fn run_prove(ctx: AppContext, command: ProveCommand) -> Result<()> {
    match command.command {
        Some(ProveSubcommand::Hash(input)) => {
            if command.input.is_some() || command.project.is_some() || command.name.is_some() {
                bail!(
                    "use either `proveria prove <input> --project <slug>` or `proveria prove hash <sha256> --project <slug> --name <name>`, not both"
                );
            }
            ensure_hex_sha256(&input.sha256)?;
            prove_hash(
                &ctx,
                ProveHashInput {
                    project: input.project,
                    label: input.name,
                    sha256: input.sha256.to_lowercase(),
                    file_name: input.file_name,
                    byte_size: input.byte_size,
                    compliance_json: input.compliance_json,
                    output: input.output,
                    source_label: "hash".to_string(),
                },
            )
            .await
        }
        Some(ProveSubcommand::File(input)) => {
            if command.input.is_some() || command.project.is_some() || command.name.is_some() {
                bail!(
                    "use either `proveria prove <input> --project <slug>` or `proveria prove file <file> --project <slug> --name <name>`, not both"
                );
            }
            let hash = sha256_file(&input.file)?;
            let label = input
                .name
                .unwrap_or_else(|| default_label_from_path(&input.file));
            let file_name = input
                .file
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| anyhow!("file name is not valid UTF-8"))?;
            let file_size = fs::metadata(&input.file)
                .with_context(|| format!("could not stat {}", input.file.display()))?
                .len();
            prove_hash(
                &ctx,
                ProveHashInput {
                    project: input.project,
                    label,
                    sha256: hash,
                    file_name: Some(file_name.to_string()),
                    byte_size: Some(file_size),
                    compliance_json: input.compliance_json,
                    output: input.output,
                    source_label: format!("file {file_name}"),
                },
            )
            .await
        }
        None => {
            let input = command.input.ok_or_else(|| {
                anyhow!("missing input. Use `proveria prove <sha256-or-file> --project <slug>`")
            })?;
            let project = command
                .project
                .ok_or_else(|| anyhow!("missing project slug. Pass `--project <slug>`"))?;
            if let Ok(sha256) = normalized_sha256(&input) {
                let label = command
                    .name
                    .ok_or_else(|| anyhow!("proving a raw hash needs `--name <name>`"))?;
                return prove_hash(
                    &ctx,
                    ProveHashInput {
                        project,
                        label,
                        sha256,
                        file_name: command.file_name,
                        byte_size: command.byte_size,
                        compliance_json: command.compliance_json,
                        output: command.output,
                        source_label: "hash".to_string(),
                    },
                )
                .await;
            }
            let file = PathBuf::from(&input);
            if command.file_name.is_some() || command.byte_size.is_some() {
                bail!("--file-name and --byte-size are only valid when proving a raw SHA-256 hash");
            }
            let hash = sha256_file(&file)?;
            let label = command
                .name
                .unwrap_or_else(|| default_label_from_path(&file));
            let file_name = file
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| anyhow!("file name is not valid UTF-8"))?;
            let file_size = fs::metadata(&file)
                .with_context(|| format!("could not stat {}", file.display()))?
                .len();
            prove_hash(
                &ctx,
                ProveHashInput {
                    project,
                    label,
                    sha256: hash,
                    file_name: Some(file_name.to_string()),
                    byte_size: Some(file_size),
                    compliance_json: command.compliance_json,
                    output: command.output,
                    source_label: format!("file {file_name}"),
                },
            )
            .await
        }
    }
}

struct ProveHashInput {
    project: String,
    label: String,
    sha256: String,
    file_name: Option<String>,
    byte_size: Option<u64>,
    compliance_json: Option<PathBuf>,
    output: OutputFormat,
    source_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceJsonMetadata {
    sha256: String,
    file_name: String,
    byte_size: u64,
    media_type: &'static str,
    canonicalization: &'static str,
}

async fn prove_hash(ctx: &AppContext, input: ProveHashInput) -> Result<()> {
    let workspace = require_workspace(ctx)?;
    let compliance = input
        .compliance_json
        .as_deref()
        .map(compliance_json_metadata)
        .transpose()?;
    let mut body = serde_json::Map::new();
    body.insert("label".to_string(), json!(input.label));
    body.insert("sha256".to_string(), json!(input.sha256));
    if let Some(file_name) = &input.file_name {
        body.insert("fileName".to_string(), json!(file_name));
    }
    if let Some(byte_size) = input.byte_size {
        body.insert("byteSize".to_string(), json!(byte_size));
    }
    if let Some(compliance) = &compliance {
        body.insert("compliance".to_string(), serde_json::to_value(compliance)?);
    }
    let file_name_for_key = input.file_name.as_deref().unwrap_or("external-sha256");
    let idempotency_key = attestation_idempotency_key(
        workspace,
        &input.project,
        &input.label,
        file_name_for_key,
        &input.sha256,
        compliance.as_ref().map(|metadata| metadata.sha256.as_str()),
    );
    let response = api_post::<CreateAttestationResponse>(
        ctx,
        &format!(
            "/v1/tenants/{workspace}/projects/{}/attestations",
            input.project
        ),
        serde_json::Value::Object(body),
        Some(idempotency_key),
    )
    .await?;
    match input.output {
        OutputFormat::Text => {
            println!("Proved {}", input.source_label);
            println!("{}", serde_json::to_string_pretty(&response.data)?);
        }
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
    }
    Ok(())
}

async fn run_receipt(ctx: AppContext, command: ReceiptCommand) -> Result<()> {
    let workspace = require_workspace(&ctx)?;
    if command.output.is_some() && !command.json && !command.pdf {
        bail!("`--output` is only used with `--json` or `--pdf`");
    }
    if command.json || command.pdf {
        return download_receipt_artifacts(&ctx, workspace, command).await;
    }
    let response = api_get::<ReceiptResponse>(
        &ctx,
        &format!(
            "/v1/tenants/{workspace}/attestations/{}/receipt",
            command.attestation
        ),
    )
    .await?;
    println!("Receipt: {}", response.data.attestation_label);
    println!("attestation_id: {}", response.data.attestation_id);
    println!("state: {}", response.data.state);
    if let Some(package_id) = response.data.package_id {
        println!("package_id: {package_id}");
    }
    if let Some(merkle_root) = response.data.merkle_root {
        println!("merkle_root: {merkle_root}");
    }
    println!(
        "receipt_json: {}",
        if response.data.receipt_available {
            "available"
        } else {
            "not available"
        }
    );
    println!(
        "receipt_pdf: {}",
        if response.data.receipt_pdf_available {
            "available"
        } else {
            "not available"
        }
    );
    if let Some(confirmed_at) = response.data.confirmed_at {
        println!("confirmed_at: {confirmed_at}");
    }
    Ok(())
}

async fn download_receipt_artifacts(
    ctx: &AppContext,
    workspace: &str,
    command: ReceiptCommand,
) -> Result<()> {
    let output_dir = command.output.unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("could not create {}", output_dir.display()))?;
    if command.json {
        let path = output_dir.join(format!("{}.receipt.json", command.attestation));
        let bytes = api_get_bytes(
            ctx,
            &format!(
                "/v1/tenants/{workspace}/attestations/{}/receipt.json",
                command.attestation
            ),
        )
        .await?;
        fs::write(&path, bytes).with_context(|| format!("could not write {}", path.display()))?;
        println!("Wrote {}", path.display());
    }
    if command.pdf {
        let path = output_dir.join(format!("{}.receipt.pdf", command.attestation));
        let bytes = api_get_bytes(
            ctx,
            &format!(
                "/v1/tenants/{workspace}/attestations/{}/receipt.pdf",
                command.attestation
            ),
        )
        .await?;
        fs::write(&path, bytes).with_context(|| format!("could not write {}", path.display()))?;
        println!("Wrote {}", path.display());
    }
    Ok(())
}

async fn run_result(ctx: AppContext, command: ResultCommand) -> Result<()> {
    if command.output.is_some() && !command.json && !command.pdf {
        bail!("`--output` is only used with `--json` or `--pdf`");
    }
    let resolved =
        public_get::<PublicResolvedLink>(&ctx, &format!("/v/{}", command.link_id)).await?;
    if resolved.target_type != "lookup_result" {
        bail!(
            "link {} is a {}, not a verification result",
            command.link_id,
            resolved.target_type
        );
    }

    if command.json || command.pdf {
        return download_result_artifacts(&ctx, command, resolved).await;
    }

    println!("Verification result: {}", resolved.link.id);
    if let Some(package_id) = resolved
        .payload
        .get("package_id")
        .and_then(|value| value.as_str())
    {
        println!("package_id: {package_id}");
    }
    if let Some(result_type) = resolved
        .payload
        .get("result_type")
        .and_then(|value| value.as_str())
    {
        println!("result_type: {result_type}");
    }
    if let Some(hash) = resolved
        .payload
        .get("submitted_hash")
        .and_then(|value| value.as_str())
    {
        println!("submitted_hash: {hash}");
    }
    println!("signed: {}", if resolved.signed { "yes" } else { "no" });
    println!("created_at: {}", resolved.link.created_at);
    println!(
        "expires_at: {}",
        resolved.link.expires_at.as_deref().unwrap_or("never")
    );
    println!("json: {}/v/{}", ctx.api_url, resolved.link.id);
    println!("pdf: {}/v/{}.pdf", ctx.api_url, resolved.link.id);
    Ok(())
}

async fn download_result_artifacts(
    ctx: &AppContext,
    command: ResultCommand,
    resolved: PublicResolvedLink,
) -> Result<()> {
    let output_dir = command.output.unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("could not create {}", output_dir.display()))?;
    if command.json {
        let path = output_dir.join(format!("{}.result.json", command.link_id));
        let mut json = serde_json::to_string_pretty(&resolved.payload)?;
        json.push('\n');
        fs::write(&path, json).with_context(|| format!("could not write {}", path.display()))?;
        println!("Wrote {}", path.display());
    }
    if command.pdf {
        let path = output_dir.join(format!("{}.result.pdf", command.link_id));
        let bytes = public_get_bytes(ctx, &format!("/v/{}.pdf", command.link_id)).await?;
        fs::write(&path, bytes).with_context(|| format!("could not write {}", path.display()))?;
        println!("Wrote {}", path.display());
    }
    Ok(())
}

async fn run_verify(ctx: AppContext, command: VerifyCommand) -> Result<()> {
    match command.command {
        Some(VerifySubcommand::Hash(input)) => {
            if command.input.is_some() || command.attestation.is_some() {
                bail!(
                    "use either `proveria verify <input> --attestation <id>` or `proveria verify hash <sha256> --attestation <id>`, not both"
                );
            }
            let sha256 = normalized_sha256(&input.sha256)?;
            verify_hash(
                &ctx,
                VerifyHashInput {
                    attestation: input.attestation,
                    sha256,
                    output: input.output,
                    source_label: "hash".to_string(),
                },
            )
            .await
        }
        Some(VerifySubcommand::File(input)) => {
            if command.input.is_some() || command.attestation.is_some() {
                bail!(
                    "use either `proveria verify <input> --attestation <id>` or `proveria verify file <file> --attestation <id>`, not both"
                );
            }
            let sha256 = sha256_file(&input.file)?;
            let source_label = format!("file {}", input.file.display());
            verify_hash(
                &ctx,
                VerifyHashInput {
                    attestation: input.attestation,
                    sha256,
                    output: input.output,
                    source_label,
                },
            )
            .await
        }
        Some(VerifySubcommand::Passage(input)) => {
            if command.input.is_some() || command.attestation.is_some() {
                bail!(
                    "use `proveria verify passage <text> --attestation <id>` for passage verification"
                );
            }
            let candidate_hashes = passage_candidate_hashes(&input.text)?;
            verify_content_hashes(
                &ctx,
                VerifyContentInput {
                    attestation: input.attestation,
                    candidate_hashes,
                    output: input.output,
                    source_label: "passage".to_string(),
                },
            )
            .await
        }
        None => {
            let input = command.input.ok_or_else(|| {
                anyhow!("missing input. Use `proveria verify <sha256-or-file> --attestation <id>`")
            })?;
            let attestation = command
                .attestation
                .ok_or_else(|| anyhow!("missing attestation id. Pass `--attestation <id>`"))?;
            if let Ok(sha256) = normalized_sha256(&input) {
                return verify_hash(
                    &ctx,
                    VerifyHashInput {
                        attestation,
                        sha256,
                        output: command.output,
                        source_label: "hash".to_string(),
                    },
                )
                .await;
            }
            let file = PathBuf::from(&input);
            let sha256 = sha256_file(&file)?;
            verify_hash(
                &ctx,
                VerifyHashInput {
                    attestation,
                    sha256,
                    output: command.output,
                    source_label: format!("file {}", file.display()),
                },
            )
            .await
        }
    }
}

struct VerifyHashInput {
    attestation: String,
    sha256: String,
    output: OutputFormat,
    source_label: String,
}

struct VerifyContentInput {
    attestation: String,
    candidate_hashes: Vec<String>,
    output: OutputFormat,
    source_label: String,
}

async fn verify_hash(ctx: &AppContext, input: VerifyHashInput) -> Result<()> {
    let workspace = require_workspace(ctx)?;
    let body = json!({
        "submittedHash": input.sha256,
        "lookupKind": "whole_file",
    });
    let response = api_post::<LookupResponse>(
        ctx,
        &format!(
            "/v1/tenants/{workspace}/attestations/{}/lookup",
            input.attestation
        ),
        body,
        None,
    )
    .await?;
    match input.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            let result = response.data.package.result_type.as_str();
            let verdict = if result == "match" {
                "MATCH"
            } else {
                "NO MATCH"
            };
            println!("{verdict}: verified {}", input.source_label);
            println!("submitted_hash: {}", response.data.package.submitted_hash);
            println!("package_id: {}", response.data.package_id);
            println!(
                "verification_url: {}{}",
                ctx.api_url, response.data.verification_url
            );
        }
    }
    Ok(())
}

async fn verify_content_hashes(ctx: &AppContext, input: VerifyContentInput) -> Result<()> {
    let workspace = require_workspace(ctx)?;
    let submitted_hash = input
        .candidate_hashes
        .first()
        .ok_or_else(|| anyhow!("passage verification needs at least 7 normalized words"))?;
    let candidate_count = input.candidate_hashes.len();
    let body = json!({
        "submittedHash": submitted_hash,
        "candidateHashes": input.candidate_hashes,
        "lookupKind": "content",
    });
    let response = api_post::<LookupResponse>(
        ctx,
        &format!(
            "/v1/tenants/{workspace}/attestations/{}/lookup",
            input.attestation
        ),
        body,
        None,
    )
    .await?;
    match input.output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&response)?),
        OutputFormat::Text => {
            let result = response.data.package.result_type.as_str();
            let verdict = if result == "match" {
                "MATCH"
            } else {
                "NO MATCH"
            };
            println!("{verdict}: verified {}", input.source_label);
            println!("candidate_hashes: {candidate_count}");
            println!("submitted_hash: {}", response.data.package.submitted_hash);
            println!("package_id: {}", response.data.package_id);
            println!(
                "verification_url: {}{}",
                ctx.api_url, response.data.verification_url
            );
        }
    }
    Ok(())
}

async fn api_get<T: for<'de> Deserialize<'de>>(ctx: &AppContext, path: &str) -> Result<T> {
    let client = Client::new();
    let response = client
        .get(format!("{}{}", ctx.api_url, path))
        .bearer_auth(require_api_key(ctx)?)
        .send()
        .await
        .with_context(|| format!("GET {path} failed"))?;
    decode_response(response).await
}

async fn api_get_bytes(ctx: &AppContext, path: &str) -> Result<Vec<u8>> {
    let client = Client::new();
    let response = client
        .get(format!("{}{}", ctx.api_url, path))
        .bearer_auth(require_api_key(ctx)?)
        .send()
        .await
        .with_context(|| format!("GET {path} failed"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("could not read GET {path} response"))?;
    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        bail!("{}", format_api_error(status, &text));
    }
    Ok(bytes.to_vec())
}

async fn public_get<T: for<'de> Deserialize<'de>>(ctx: &AppContext, path: &str) -> Result<T> {
    let client = Client::new();
    let response = client
        .get(format!("{}{}", ctx.api_url, path))
        .send()
        .await
        .with_context(|| format!("GET {path} failed"))?;
    decode_response(response).await
}

async fn public_get_bytes(ctx: &AppContext, path: &str) -> Result<Vec<u8>> {
    let client = Client::new();
    let response = client
        .get(format!("{}{}", ctx.api_url, path))
        .send()
        .await
        .with_context(|| format!("GET {path} failed"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("could not read GET {path} response"))?;
    if status == StatusCode::ACCEPTED {
        bail!("PDF is still rendering. Try again in a moment.");
    }
    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        bail!("{}", format_api_error(status, &text));
    }
    Ok(bytes.to_vec())
}

async fn session_get<T: for<'de> Deserialize<'de>>(ctx: &AppContext, path: &str) -> Result<T> {
    let client = Client::new();
    let response = client
        .get(format!("{}{}", ctx.api_url, path))
        .header(COOKIE, require_session_cookie(ctx)?)
        .send()
        .await
        .with_context(|| format!("GET {path} failed"))?;
    decode_response(response).await
}

async fn session_post<T: for<'de> Deserialize<'de>>(
    ctx: &AppContext,
    path: &str,
    body: serde_json::Value,
) -> Result<T> {
    let client = Client::new();
    let response = client
        .post(format!("{}{}", ctx.api_url, path))
        .header(COOKIE, require_session_cookie(ctx)?)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("POST {path} failed"))?;
    decode_response(response).await
}

async fn session_delete(ctx: &AppContext, path: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .delete(format!("{}{}", ctx.api_url, path))
        .header(COOKIE, require_session_cookie(ctx)?)
        .send()
        .await
        .with_context(|| format!("DELETE {path} failed"))?;
    let status = response.status();
    if status == StatusCode::NO_CONTENT {
        return Ok(());
    }
    let text = response
        .text()
        .await
        .with_context(|| format!("could not read DELETE {path} response"))?;
    if !status.is_success() {
        bail!("{}", format_api_error(status, &text));
    }
    Ok(())
}

async fn api_post<T: for<'de> Deserialize<'de>>(
    ctx: &AppContext,
    path: &str,
    body: serde_json::Value,
    idempotency_key: Option<String>,
) -> Result<T> {
    let client = Client::new();
    let mut request = client
        .post(format!("{}{}", ctx.api_url, path))
        .bearer_auth(require_api_key(ctx)?)
        .json(&body);
    if let Some(key) = idempotency_key {
        request = request.header("Idempotency-Key", key);
    }
    let response = request
        .send()
        .await
        .with_context(|| format!("POST {path} failed"))?;
    decode_response(response).await
}

async fn api_delete(ctx: &AppContext, path: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .delete(format!("{}{}", ctx.api_url, path))
        .bearer_auth(require_api_key(ctx)?)
        .send()
        .await
        .with_context(|| format!("DELETE {path} failed"))?;
    let status = response.status();
    if status == StatusCode::NO_CONTENT {
        return Ok(());
    }
    let text = response
        .text()
        .await
        .with_context(|| format!("could not read DELETE {path} response"))?;
    if !status.is_success() {
        bail!("{}", format_api_error(status, &text));
    }
    Ok(())
}

fn access_grant_idempotency_key(workspace: &str, attestation: &str, email: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(attestation.as_bytes());
    hasher.update(b"\0");
    hasher.update(email.trim().to_lowercase().as_bytes());
    format!("cli-access-{}", hex::encode(hasher.finalize()))
}

fn attestation_idempotency_key(
    workspace: &str,
    project: &str,
    label: &str,
    file_name: &str,
    sha256: &str,
    compliance_sha256: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(project.as_bytes());
    hasher.update(b"\0");
    hasher.update(label.as_bytes());
    hasher.update(b"\0");
    hasher.update(file_name.as_bytes());
    hasher.update(b"\0");
    hasher.update(sha256.as_bytes());
    if let Some(compliance_sha256) = compliance_sha256 {
        hasher.update(b"\0");
        hasher.update(compliance_sha256.as_bytes());
    }
    format!("cli-attest-{}", hex::encode(hasher.finalize()))
}

fn project_idempotency_key(workspace: &str, slug: &str, name: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(slug.as_bytes());
    hasher.update(b"\0");
    hasher.update(name.as_bytes());
    format!("cli-project-{}", hex::encode(hasher.finalize()))
}

fn webhook_idempotency_key(
    workspace: &str,
    body: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(serde_json::to_string(body).unwrap_or_default().as_bytes());
    format!("cli-webhook-{}", hex::encode(hasher.finalize()))
}

fn evidence_export_idempotency_key(
    workspace: &str,
    body: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(serde_json::to_string(body).unwrap_or_default().as_bytes());
    format!("cli-export-{}", hex::encode(hasher.finalize()))
}

fn webhook_test_idempotency_key(workspace: &str, endpoint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace.as_bytes());
    hasher.update(b"\0");
    hasher.update(endpoint.as_bytes());
    format!("cli-webhook-test-{}", hex::encode(hasher.finalize()))
}

async fn decode_response<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    if status == StatusCode::NO_CONTENT {
        bail!("API returned no content");
    }
    let text = response
        .text()
        .await
        .context("could not read API response")?;
    if !status.is_success() {
        bail!("{}", format_api_error(status, &text));
    }
    serde_json::from_str(&text).with_context(|| format!("could not decode API response: {text}"))
}

fn format_api_error(status: StatusCode, body: &str) -> String {
    if let Ok(envelope) = serde_json::from_str::<PublicApiErrorEnvelope>(body) {
        let retry = if envelope.error.retryable {
            "retryable"
        } else {
            "not retryable"
        };
        return format!(
            "API request failed with HTTP {} ({}): {} [{}; request id: {}]",
            status.as_u16(),
            envelope.error.code,
            envelope.error.message,
            retry,
            envelope.error.request_id,
        );
    }

    let trimmed = body.trim();
    if trimmed.is_empty() {
        format!("API request failed with HTTP {}", status.as_u16())
    } else {
        format!(
            "API request failed with HTTP {}: {trimmed}",
            status.as_u16()
        )
    }
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        fs::File::open(path).with_context(|| format!("could not open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 64];
    loop {
        let bytes = file
            .read(&mut buffer)
            .with_context(|| format!("could not read {}", path.display()))?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn compliance_json_metadata(path: &Path) -> Result<ComplianceJsonMetadata> {
    let text =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("could not parse {}", path.display()))?;
    if !parsed.is_object() {
        bail!("compliance JSON must be a JSON object");
    }
    let canonical = canonical_json(&parsed);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("compliance JSON file name is not valid UTF-8"))?
        .to_string();
    Ok(ComplianceJsonMetadata {
        sha256: hex::encode(Sha256::digest(canonical.as_bytes())),
        file_name,
        byte_size: canonical.len() as u64,
        media_type: "application/json",
        canonicalization: "json-stable-v1",
    })
}

fn dataset_inventory_template() -> serde_json::Value {
    let files = vec![
        json!({
            "path": "train/example-001.jsonl",
            "sha256": sample_hash("dataset-file-1"),
            "byte_size": 1024,
            "media_type": "application/jsonl"
        }),
        json!({
            "path": "eval/example-001.jsonl",
            "sha256": sample_hash("dataset-file-2"),
            "byte_size": 512,
            "media_type": "application/jsonl"
        }),
    ];
    let dataset_root_hash = hex::encode(Sha256::digest(canonical_json(&json!(files)).as_bytes()));
    json!({
        "record_type": "dataset_inventory_record",
        "schema_version": "0.1",
        "dataset": {
            "name": "Graduation Training Dataset",
            "version": "2026.06",
            "description": "Dataset inventory for approved model training and evaluation.",
            "inventory_scope": "folder",
            "source_owner": "Data Governance",
            "license_usage_basis": "Internal governed dataset approval.",
            "data_classification": "confidential",
            "retention_rule": "7 years"
        },
        "summary": {
            "file_count": files.len(),
            "total_bytes": 1536,
            "dataset_root_hash": dataset_root_hash,
            "hash_algorithm": "sha256"
        },
        "files": files,
        "privacy": {
            "raw_files_uploaded_to_proveria": false,
            "stored_by_proveria": [
                "canonical inventory hash",
                "file hashes",
                "file paths if this inventory record is stored in your evidence repository"
            ],
            "local_only": ["raw dataset file bytes"]
        }
    })
}

fn model_release_template() -> serde_json::Value {
    json!({
        "record_type": "model_provenance_record",
        "schema_version": "0.1",
        "model": {
            "name": "Graduation Model",
            "version": "2026.06",
            "type": "classifier",
            "base_model": "",
            "base_model_provider": "",
            "parent_receipt_ids": [],
            "owner_team": "Model Governance",
            "model_owner": "model-owner@example.com",
            "intended_use": "Predict graduation readiness for approved internal workflows.",
            "prohibited_uses": "Do not use for automated adverse decisions without human review.",
            "release_stage": "production"
        },
        "claim": {
            "claim_id": "",
            "claim_type": "model_release_approved",
            "claim_text": "This model version was approved for production release under the attached governance policy.",
            "claim_scope": "full_release_package",
            "subject_type": "model_artifact",
            "subject_identifier": "registry://models/graduation/2026.06",
            "subject_hash": sample_hash("subject")
        },
        "artifacts": {
            "weights_hash": sample_hash("weights"),
            "config_hash": sample_hash("config"),
            "tokenizer_hash": sample_hash("tokenizer"),
            "adapter_hashes": [],
            "model_card_hash": sample_hash("model-card"),
            "container_image_digest": "",
            "source_repository_url": "",
            "source_commit_sha": "",
            "sbom_reference": "",
            "artifact_manifest_hash": sample_hash("artifact-manifest")
        },
        "data_provenance": {
            "dataset_manifest_ref": "s3://example-bucket/model-release/dataset-manifest.json",
            "dataset_manifest_hash": sample_hash("dataset-manifest"),
            "training_datasets": [
                {
                    "dataset_name": "graduation-training",
                    "dataset_version": "2026.06",
                    "dataset_hash": sample_hash("training-dataset"),
                    "source_system": "warehouse",
                    "source_owner": "Data Governance",
                    "collection_date_range": "2025-01-01/2026-05-31",
                    "license_contract_reference": "internal-policy://data-use/graduation",
                    "inclusion_status": "Included in training",
                    "notes": ""
                }
            ],
            "excluded_datasets": [],
            "data_classification": "confidential",
            "contains_pii": true,
            "contains_phi": false,
            "contains_customer_data": false,
            "consent_or_contract_basis": "Internal educational records governance approval.",
            "retention_rule": "7 years"
        },
        "training": {
            "training_run_id": "train-2026-06-001",
            "training_code_commit": "0000000000000000000000000000000000000000",
            "training_environment": "internal-ml-platform",
            "training_started_at": "2026-06-01T13:00:00Z",
            "training_ended_at": "2026-06-01T17:30:00Z",
            "framework": "scikit-learn",
            "hyperparameter_manifest_hash": sample_hash("hyperparameters"),
            "random_seed": "42",
            "trainer": "ml-platform",
            "training_run_manifest_hash": sample_hash("training-run")
        },
        "evaluation": {
            "evaluation_report_ref": "s3://example-bucket/model-release/evaluation-report.pdf",
            "evaluation_report_hash": sample_hash("evaluation-report"),
            "evaluation_suite": "graduation-model-release-v1",
            "evaluation_result": "pass",
            "required_thresholds_met": true,
            "risk_review_hash": sample_hash("risk-review"),
            "known_limitations": "Performance should be monitored for drift across cohorts.",
            "safety_review_hash": "",
            "bias_fairness_review_hash": "",
            "security_review_hash": ""
        },
        "policy": {
            "policy_id": "AI-GOV-001",
            "policy_version": "2026.1",
            "policy_template": "production-model-release",
            "required_controls": ["model_card", "dataset_manifest", "evaluation_report", "risk_review", "approval_record"],
            "required_evidence_checklist": [
                { "control": "model_card", "status": "complete" },
                { "control": "dataset_manifest", "status": "complete" },
                { "control": "evaluation_report", "status": "complete" },
                { "control": "risk_review", "status": "complete" },
                { "control": "approval_record", "status": "complete" }
            ],
            "policy_decision": "approved",
            "exceptions": []
        },
        "approval": {
            "submitted_by": "model-owner@example.com",
            "submitted_at": "2026-06-02T14:00:00Z",
            "model_owner_approval": "model-owner@example.com 2026-06-02T15:00:00Z",
            "compliance_review": "compliance@example.com 2026-06-03T15:00:00Z",
            "security_review": "security@example.com 2026-06-03T16:00:00Z",
            "data_governance_review": "data-governance@example.com 2026-06-03T17:00:00Z",
            "legal_review": "",
            "final_approver": "Model Risk Committee",
            "final_approval_timestamp": "2026-06-04T18:00:00Z",
            "approval_record_hash": sample_hash("approval-record")
        },
        "deployment": {
            "deployment_authorized": true,
            "deployment_environment": "production",
            "deployment_target": "https://models.example.com/graduation/2026.06",
            "deployment_manifest_hash": sample_hash("deployment-manifest"),
            "release_version": "2026.06",
            "rollout_plan": "Limited rollout followed by full production release after monitoring review.",
            "rollback_plan": "Revert endpoint alias to prior approved model receipt.",
            "monitoring_plan_ref": "s3://example-bucket/model-release/monitoring-plan.pdf",
            "deployed_at": ""
        },
        "disclosure": {
            "disclosure_mode": "public_receipt_private_evidence",
            "public_fields": ["model.name", "model.version", "claim.claim_type", "policy.policy_id"],
            "private_evidence_stored": true,
            "evidence_access_rule": "request_based",
            "redaction_profile": "model-release-standard",
            "verification_policy": "verify_model_release_claim",
            "retention_period": "7 years"
        },
        "receipt": {
            "receipt_id": "",
            "claim_id": "",
            "evidence_package_id": "",
            "evidence_root_hash": "",
            "receipt_hash": "",
            "signer_id": "",
            "signature": "",
            "signature_algorithm": "",
            "timestamp": "",
            "verification_url": "",
            "supersedes_receipt_id": "",
            "revocation_reason": ""
        }
    })
}

fn sample_hash(label: &str) -> String {
    hex::encode(Sha256::digest(label.as_bytes()))
}

fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
        serde_json::Value::Array(values) => {
            let items = values.iter().map(canonical_json).collect::<Vec<_>>();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(values) => {
            let sorted = values
                .iter()
                .map(|(key, value)| (key, value))
                .collect::<BTreeMap<_, _>>();
            let items = sorted
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        canonical_json(value)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", items.join(","))
        }
    }
}

fn ensure_hex_sha256(value: &str) -> Result<()> {
    let valid = value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit());
    if valid {
        Ok(())
    } else {
        bail!("expected a 64-character SHA-256 hex digest")
    }
}

fn normalized_sha256(value: &str) -> Result<String> {
    ensure_hex_sha256(value)?;
    Ok(value.to_lowercase())
}

fn passage_candidate_hashes(text: &str) -> Result<Vec<String>> {
    let normalized = normalize_for_shingling(text)?;
    let tokens = tokenize_normalized(&normalized);
    if tokens.iter().all(|paragraph| paragraph.len() < 7) {
        bail!("passage verification needs at least 7 normalized words from one continuous passage");
    }

    let mut seen = HashSet::new();
    let mut hashes = Vec::new();
    for (preset, window, stride) in CONTENT_PROOF_PRESETS {
        for method in CONTENT_PROOF_METHODS {
            for paragraph in &tokens {
                if paragraph.len() < window {
                    continue;
                }
                let mut index = 0;
                while index + window <= paragraph.len() {
                    let window_text = paragraph[index..index + window].join(" ");
                    let hash = shingle_payload_hash(preset, method, &window_text);
                    if seen.insert(hash.clone()) {
                        hashes.push(hash);
                    }
                    index += stride;
                }
            }
        }
    }

    if hashes.is_empty() {
        bail!(
            "passage verification needs more continuous text for the supported content proof presets"
        );
    }
    Ok(hashes)
}

fn normalize_for_shingling(text: &str) -> Result<String> {
    let mut normalized = text.nfc().collect::<String>().to_lowercase();
    normalized = normalized
        .replace(['\u{2018}', '\u{2019}'], "'")
        .replace(['\u{201c}', '\u{201d}'], "\"")
        .replace(['\u{2013}', '\u{2014}'], "-")
        .replace('\u{2026}', "...")
        .replace('\u{fb00}', "ff")
        .replace('\u{fb01}', "fi")
        .replace('\u{fb02}', "fl")
        .replace('\u{fb03}', "ffi")
        .replace('\u{fb04}', "ffl")
        .replace('\u{00ad}', "")
        .replace('\u{000c}', "\n\n");

    let hyphenated_line_break = Regex::new(r"-\n[ \t]*")?;
    normalized = hyphenated_line_break
        .replace_all(&normalized, "")
        .to_string();

    let paragraph_break = Regex::new(r"(?:[ \t\r\x0B\x0C]*\n[ \t\r\x0B\x0C]*){2,}")?;
    let punctuation = Regex::new(r##"[!"#$%&'()*+,./:;<=>?@\[\\\]^_`{|}~]"##)?;
    let paragraphs = paragraph_break
        .split(&normalized)
        .map(|paragraph| {
            let paragraph = paragraph.replace('\n', " ");
            let paragraph = punctuation.replace_all(&paragraph, " ");
            paragraph.split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .filter(|paragraph| !paragraph.is_empty())
        .collect::<Vec<_>>();

    Ok(paragraphs.join("\n\n"))
}

fn tokenize_normalized(normalized: &str) -> Vec<Vec<&str>> {
    normalized
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .split(' ')
                .filter(|token| !token.is_empty())
                .collect()
        })
        .collect()
}

fn shingle_payload_hash(preset: &str, source_extraction_method: &str, window_text: &str) -> String {
    let mut payload = vec![0x02];
    append_length_prefixed(&mut payload, "1.0");
    append_length_prefixed(&mut payload, preset);
    append_length_prefixed(&mut payload, "1.0");
    append_length_prefixed(&mut payload, "1.0");
    append_length_prefixed(&mut payload, source_extraction_method);
    append_length_prefixed(&mut payload, window_text);
    hex::encode(Sha256::digest(&payload))
}

fn append_length_prefixed(payload: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    payload.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(bytes);
}

fn append_query(path: &mut String, query: Vec<(&str, String)>) {
    if query.is_empty() {
        return;
    }
    let encoded = query
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    path.push('?');
    path.push_str(&encoded);
}

fn require_api_key(ctx: &AppContext) -> Result<&str> {
    ctx.api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "missing API key. Set PROVERIA_API_KEY or run `proveria config set --api-key ...`"
            )
        })
}

fn require_session_cookie(ctx: &AppContext) -> Result<&str> {
    ctx.session_cookie.as_deref().ok_or_else(|| {
        anyhow!("missing admin session. Run `proveria auth login --email ... --password ...`")
    })
}

fn require_workspace(ctx: &AppContext) -> Result<&str> {
    ctx.workspace
        .as_deref()
        .ok_or_else(|| anyhow!("missing workspace slug. Set PROVERIA_WORKSPACE or run `proveria config set --workspace ...`"))
}

fn extract_session_cookie(set_cookie: &str) -> Option<String> {
    let cookie = set_cookie.split(';').next()?.trim();
    if cookie.starts_with(&format!("{SESSION_COOKIE_NAME}=")) {
        Some(cookie.to_string())
    } else {
        None
    }
}

fn normalize_api_key_scopes(scopes: Vec<String>) -> Result<Vec<String>> {
    let scopes = if scopes.is_empty() {
        vec!["read".to_string()]
    } else {
        scopes
    };
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for scope in scopes {
        let scope = scope.trim().to_lowercase();
        if !matches!(scope.as_str(), "read" | "write") {
            bail!("invalid API key scope `{scope}`. Use read or write.");
        }
        if seen.insert(scope.clone()) {
            normalized.push(scope);
        }
    }
    Ok(normalized)
}

fn api_key_expiration_from_duration(input: &str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.len() < 2 {
        bail!("invalid --expires-in `{input}`. Use a duration like 30d, 12h, or 90m.");
    }
    let (amount, unit) = trimmed.split_at(trimmed.len() - 1);
    let amount: i64 = amount
        .parse()
        .with_context(|| format!("invalid --expires-in `{input}`. Use a numeric duration."))?;
    if amount <= 0 {
        bail!("invalid --expires-in `{input}`. Duration must be greater than zero.");
    }
    let duration = match unit {
        "m" => TimeDuration::minutes(amount),
        "h" => TimeDuration::hours(amount),
        "d" => TimeDuration::days(amount),
        "w" => TimeDuration::weeks(amount),
        _ => bail!("invalid --expires-in `{input}`. Use m, h, d, or w."),
    };
    OffsetDateTime::now_utc()
        .checked_add(duration)
        .ok_or_else(|| anyhow!("invalid --expires-in `{input}`. Duration is too large."))?
        .format(&Rfc3339)
        .context("failed to format API key expiration")
}

fn default_label_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("attestation")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn load_config() -> Result<ConfigFile> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(ConfigFile::default());
    }
    let text =
        fs::read_to_string(&path).with_context(|| format!("could not read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("could not parse {}", path.display()))
}

fn save_config(config: &ConfigFile) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut text = serde_json::to_string_pretty(config)?;
    text.push('\n');
    fs::write(&path, text).with_context(|| format!("could not write {}", path.display()))
}

fn config_path() -> Result<PathBuf> {
    let base =
        dirs::config_dir().ok_or_else(|| anyhow!("could not resolve user config directory"))?;
    Ok(base.join("proveria").join("config.json"))
}

fn load_evidence_bundle(path: &Path) -> Result<EvidenceExportBundle> {
    let text =
        fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("could not parse {}", path.display()))
}

fn validate_evidence_bundle(bundle: &EvidenceExportBundle) -> Result<()> {
    if bundle.bundle_type != "proveria_evidence_bundle" {
        bail!("unsupported evidence bundle type: {}", bundle.bundle_type);
    }
    if bundle.schema_version != "1.0" {
        bail!(
            "unsupported evidence bundle schema version: {}",
            bundle.schema_version
        );
    }
    for artifact in &bundle.artifacts {
        safe_bundle_path(&artifact.path)?;
        if artifact.encoding != "base64" {
            bail!(
                "unsupported artifact encoding for {}: {}",
                artifact.path,
                artifact.encoding
            );
        }
        let bytes = decode_base64(&artifact.body_base64)
            .with_context(|| format!("could not decode {}", artifact.path))?;
        if bytes.len() != artifact.byte_size {
            bail!(
                "decoded byte size for {} was {}, expected {}",
                artifact.path,
                bytes.len(),
                artifact.byte_size
            );
        }
    }
    Ok(())
}

fn inspect_evidence_bundle(
    bundle: &EvidenceExportBundle,
) -> Result<EvidenceExportBundleInspection> {
    validate_evidence_bundle(bundle)?;
    let total_artifact_bytes = bundle
        .artifacts
        .iter()
        .map(|artifact| artifact.byte_size)
        .sum();
    let manifest_counts = bundle
        .manifest
        .get("export")
        .and_then(|export| export.get("counts"))
        .cloned();
    let artifacts = bundle
        .artifacts
        .iter()
        .map(|artifact| EvidenceExportBundleArtifactSummary {
            path: artifact.path.clone(),
            content_type: artifact.content_type.clone(),
            byte_size: artifact.byte_size,
            object_key: artifact.object_key.clone(),
        })
        .collect();

    Ok(EvidenceExportBundleInspection {
        schema_version: bundle.schema_version.clone(),
        bundle_type: bundle.bundle_type.clone(),
        generated_at: bundle.generated_at.clone(),
        artifact_count: bundle.artifacts.len(),
        missing_artifact_count: bundle.missing_artifacts.len(),
        total_artifact_bytes,
        manifest_counts,
        artifacts,
        missing_artifacts: bundle.missing_artifacts.clone(),
    })
}

fn print_evidence_bundle_inspection(inspection: &EvidenceExportBundleInspection) {
    println!("Evidence bundle");
    println!("type: {}", inspection.bundle_type);
    println!("schema_version: {}", inspection.schema_version);
    println!("generated_at: {}", inspection.generated_at);
    println!("artifacts: {}", inspection.artifact_count);
    println!("missing_artifacts: {}", inspection.missing_artifact_count);
    println!("total_artifact_bytes: {}", inspection.total_artifact_bytes);
    if let Some(counts) = &inspection.manifest_counts {
        println!("manifest_counts: {counts}");
    }
    if !inspection.artifacts.is_empty() {
        println!();
        println!("PATH\tCONTENT TYPE\tBYTES");
        for artifact in &inspection.artifacts {
            println!(
                "{}\t{}\t{}",
                artifact.path, artifact.content_type, artifact.byte_size
            );
        }
    }
    if !inspection.missing_artifacts.is_empty() {
        println!();
        println!("Missing artifacts");
        println!("PATH\tREASON");
        for artifact in &inspection.missing_artifacts {
            println!("{}\t{}", artifact.path, artifact.reason);
        }
    }
}

fn check_evidence_export_package(path: &Path) -> Result<EvidenceExportPackageCheck> {
    if path.is_dir() {
        return check_evidence_export_directory(path);
    }
    if path.is_file() {
        let bundle = load_evidence_bundle(path)?;
        let inspection = inspect_evidence_bundle(&bundle)?;
        return Ok(EvidenceExportPackageCheck {
            path: path.display().to_string(),
            kind: "bundle".to_string(),
            valid: true,
            artifact_count: inspection.artifact_count,
            missing_artifact_count: inspection.missing_artifact_count,
            total_artifact_bytes: inspection.total_artifact_bytes,
            checked_files: vec![path.display().to_string()],
        });
    }
    bail!("{} is not a file or directory", path.display());
}

fn check_evidence_export_directory(path: &Path) -> Result<EvidenceExportPackageCheck> {
    let bundle_path = path.join("bundle.json");
    let bundle = load_evidence_bundle(&bundle_path)?;
    let inspection = inspect_evidence_bundle(&bundle)?;
    let mut checked_files = vec!["bundle.json".to_string()];

    let manifest_path = path.join("manifest.json");
    let manifest = load_json_file(&manifest_path)?;
    if manifest != bundle.manifest {
        bail!("manifest.json does not match bundle manifest");
    }
    checked_files.push("manifest.json".to_string());

    for artifact in &bundle.artifacts {
        let relative_path = safe_bundle_path(&artifact.path)?;
        let artifact_path = path.join(&relative_path);
        let actual = fs::read(&artifact_path)
            .with_context(|| format!("could not read {}", artifact_path.display()))?;
        let expected = decode_base64(&artifact.body_base64)
            .with_context(|| format!("could not decode {}", artifact.path))?;
        if actual != expected {
            bail!("{} does not match bundle payload", artifact.path);
        }
        checked_files.push(relative_path.display().to_string());
    }

    let missing_path = path.join("missing-artifacts.json");
    if bundle.missing_artifacts.is_empty() {
        if missing_path.exists() {
            let missing = load_json_file(&missing_path)?;
            if missing != json!([]) {
                bail!("missing-artifacts.json exists but bundle has no missing artifacts");
            }
            checked_files.push("missing-artifacts.json".to_string());
        }
    } else {
        let missing = load_json_file(&missing_path)?;
        let expected = serde_json::to_value(&bundle.missing_artifacts)?;
        if missing != expected {
            bail!("missing-artifacts.json does not match bundle missing artifacts");
        }
        checked_files.push("missing-artifacts.json".to_string());
    }

    let summary_path = path.join("summary.json");
    if summary_path.exists() {
        let summary: EvidenceExportCollectionSummary = serde_json::from_slice(
            &fs::read(&summary_path)
                .with_context(|| format!("could not read {}", summary_path.display()))?,
        )
        .with_context(|| format!("could not parse {}", summary_path.display()))?;
        if summary.unpacked_artifact_count != inspection.artifact_count {
            bail!(
                "summary.json unpacked_artifact_count was {}, expected {}",
                summary.unpacked_artifact_count,
                inspection.artifact_count
            );
        }
        if summary.missing_artifact_count != inspection.missing_artifact_count {
            bail!(
                "summary.json missing_artifact_count was {}, expected {}",
                summary.missing_artifact_count,
                inspection.missing_artifact_count
            );
        }
        if summary.total_artifact_bytes != inspection.total_artifact_bytes {
            bail!(
                "summary.json total_artifact_bytes was {}, expected {}",
                summary.total_artifact_bytes,
                inspection.total_artifact_bytes
            );
        }
        checked_files.push("summary.json".to_string());
    }

    Ok(EvidenceExportPackageCheck {
        path: path.display().to_string(),
        kind: "directory".to_string(),
        valid: true,
        artifact_count: inspection.artifact_count,
        missing_artifact_count: inspection.missing_artifact_count,
        total_artifact_bytes: inspection.total_artifact_bytes,
        checked_files,
    })
}

fn load_json_file(path: &Path) -> Result<serde_json::Value> {
    serde_json::from_slice(
        &fs::read(path).with_context(|| format!("could not read {}", path.display()))?,
    )
    .with_context(|| format!("could not parse {}", path.display()))
}

fn print_evidence_export_package_check(check: &EvidenceExportPackageCheck) {
    println!("Evidence package check");
    println!("path: {}", check.path);
    println!("kind: {}", check.kind);
    println!("valid: {}", check.valid);
    println!("artifacts: {}", check.artifact_count);
    println!("missing_artifacts: {}", check.missing_artifact_count);
    println!("total_artifact_bytes: {}", check.total_artifact_bytes);
    println!("checked_files: {}", check.checked_files.len());
    for file in &check.checked_files {
        println!("- {file}");
    }
}

fn unpack_evidence_bundle(bundle: &EvidenceExportBundle, output: &Path) -> Result<()> {
    validate_evidence_bundle(bundle)?;
    fs::create_dir_all(output).with_context(|| format!("could not create {}", output.display()))?;

    let manifest_path = output.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_vec_pretty(&bundle.manifest)?)
        .with_context(|| format!("could not write {}", manifest_path.display()))?;

    for artifact in &bundle.artifacts {
        let relative_path = safe_bundle_path(&artifact.path)?;
        let destination = output.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("could not create {}", parent.display()))?;
        }
        let bytes = decode_base64(&artifact.body_base64)
            .with_context(|| format!("could not decode {}", artifact.path))?;
        fs::write(&destination, bytes)
            .with_context(|| format!("could not write {}", destination.display()))?;
    }

    if !bundle.missing_artifacts.is_empty() {
        let missing_path = output.join("missing-artifacts.json");
        fs::write(
            &missing_path,
            serde_json::to_vec_pretty(&bundle.missing_artifacts)?,
        )
        .with_context(|| format!("could not write {}", missing_path.display()))?;
    }

    Ok(())
}

struct ZipEntry {
    path: String,
    bytes: Vec<u8>,
}

fn write_evidence_bundle_zip(bundle: &EvidenceExportBundle, output: &Path) -> Result<()> {
    let entries = evidence_bundle_zip_entries(bundle)?;
    write_zip_archive(output, &entries)
}

fn write_evidence_bundle_tar(bundle: &EvidenceExportBundle, output: &Path) -> Result<()> {
    let entries = evidence_bundle_zip_entries(bundle)?;
    write_tar_archive(output, &entries)
}

fn evidence_bundle_zip_entries(bundle: &EvidenceExportBundle) -> Result<Vec<ZipEntry>> {
    validate_evidence_bundle(bundle)?;
    let mut entries = Vec::new();
    let mut paths = HashSet::new();
    push_zip_entry(
        &mut entries,
        &mut paths,
        "bundle.json".to_string(),
        serde_json::to_vec_pretty(bundle)?,
    )?;
    push_zip_entry(
        &mut entries,
        &mut paths,
        "manifest.json".to_string(),
        serde_json::to_vec_pretty(&bundle.manifest)?,
    )?;
    for artifact in &bundle.artifacts {
        let path = safe_bundle_path_string(&artifact.path)?;
        let bytes = decode_base64(&artifact.body_base64)
            .with_context(|| format!("could not decode {}", artifact.path))?;
        push_zip_entry(&mut entries, &mut paths, path, bytes)?;
    }
    if !bundle.missing_artifacts.is_empty() {
        push_zip_entry(
            &mut entries,
            &mut paths,
            "missing-artifacts.json".to_string(),
            serde_json::to_vec_pretty(&bundle.missing_artifacts)?,
        )?;
    }
    Ok(entries)
}

fn push_zip_entry(
    entries: &mut Vec<ZipEntry>,
    paths: &mut HashSet<String>,
    path: String,
    bytes: Vec<u8>,
) -> Result<()> {
    if !paths.insert(path.clone()) {
        bail!("duplicate archive path: {path}");
    }
    entries.push(ZipEntry { path, bytes });
    Ok(())
}

fn write_zip_archive(output: &Path, entries: &[ZipEntry]) -> Result<()> {
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut file = fs::File::create(output)
        .with_context(|| format!("could not create {}", output.display()))?;
    let mut central_directory = Vec::new();
    let mut central_records = 0u16;
    let mut offset = 0u32;

    for entry in entries {
        let name = entry.path.as_bytes();
        let name_len = u16::try_from(name.len())
            .with_context(|| format!("archive path is too long: {}", entry.path))?;
        let size = u32::try_from(entry.bytes.len())
            .with_context(|| format!("archive entry is too large: {}", entry.path))?;
        let crc = crc32(&entry.bytes);
        let local_offset = offset;

        let mut local_header = Vec::new();
        write_u32(&mut local_header, 0x0403_4b50)?;
        write_u16(&mut local_header, 20)?;
        write_u16(&mut local_header, 0)?;
        write_u16(&mut local_header, 0)?;
        write_u16(&mut local_header, 0)?;
        write_u16(&mut local_header, 33)?;
        write_u32(&mut local_header, crc)?;
        write_u32(&mut local_header, size)?;
        write_u32(&mut local_header, size)?;
        write_u16(&mut local_header, name_len)?;
        write_u16(&mut local_header, 0)?;
        local_header.extend_from_slice(name);
        file.write_all(&local_header)
            .with_context(|| format!("could not write {}", output.display()))?;
        file.write_all(&entry.bytes)
            .with_context(|| format!("could not write {}", output.display()))?;

        let written = u32::try_from(local_header.len() + entry.bytes.len())
            .context("archive is too large")?;
        offset = offset
            .checked_add(written)
            .context("archive is too large")?;

        write_u32(&mut central_directory, 0x0201_4b50)?;
        write_u16(&mut central_directory, 20)?;
        write_u16(&mut central_directory, 20)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 33)?;
        write_u32(&mut central_directory, crc)?;
        write_u32(&mut central_directory, size)?;
        write_u32(&mut central_directory, size)?;
        write_u16(&mut central_directory, name_len)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 0)?;
        write_u16(&mut central_directory, 0)?;
        write_u32(&mut central_directory, 0)?;
        write_u32(&mut central_directory, local_offset)?;
        central_directory.extend_from_slice(name);
        central_records = central_records
            .checked_add(1)
            .context("too many archive entries")?;
    }

    let central_offset = offset;
    let central_size = u32::try_from(central_directory.len()).context("archive is too large")?;
    file.write_all(&central_directory)
        .with_context(|| format!("could not write {}", output.display()))?;

    let mut end_record = Vec::new();
    write_u32(&mut end_record, 0x0605_4b50)?;
    write_u16(&mut end_record, 0)?;
    write_u16(&mut end_record, 0)?;
    write_u16(&mut end_record, central_records)?;
    write_u16(&mut end_record, central_records)?;
    write_u32(&mut end_record, central_size)?;
    write_u32(&mut end_record, central_offset)?;
    write_u16(&mut end_record, 0)?;
    file.write_all(&end_record)
        .with_context(|| format!("could not write {}", output.display()))?;
    Ok(())
}

fn write_tar_archive(output: &Path, entries: &[ZipEntry]) -> Result<()> {
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create {}", parent.display()))?;
    }
    let mut file = fs::File::create(output)
        .with_context(|| format!("could not create {}", output.display()))?;
    for entry in entries {
        let header = tar_header(&entry.path, entry.bytes.len())?;
        file.write_all(&header)
            .with_context(|| format!("could not write {}", output.display()))?;
        file.write_all(&entry.bytes)
            .with_context(|| format!("could not write {}", output.display()))?;
        let padding = tar_padding(entry.bytes.len());
        if padding > 0 {
            file.write_all(&vec![0u8; padding])
                .with_context(|| format!("could not write {}", output.display()))?;
        }
    }
    file.write_all(&[0u8; 1024])
        .with_context(|| format!("could not write {}", output.display()))?;
    Ok(())
}

fn tar_header(path: &str, size: usize) -> Result<[u8; 512]> {
    let (name, prefix) = split_tar_path(path)?;
    let mut header = [0u8; 512];
    write_tar_bytes(&mut header[0..100], name.as_bytes(), "tar path name")?;
    write_tar_octal(&mut header[100..108], 0o644)?;
    write_tar_octal(&mut header[108..116], 0)?;
    write_tar_octal(&mut header[116..124], 0)?;
    write_tar_octal(&mut header[124..136], size as u64)?;
    write_tar_octal(&mut header[136..148], 0)?;
    for byte in &mut header[148..156] {
        *byte = b' ';
    }
    header[156] = b'0';
    write_tar_bytes(&mut header[257..263], b"ustar\0", "tar magic")?;
    write_tar_bytes(&mut header[263..265], b"00", "tar version")?;
    if let Some(prefix) = prefix {
        write_tar_bytes(&mut header[345..500], prefix.as_bytes(), "tar path prefix")?;
    }
    let checksum = header.iter().map(|byte| u32::from(*byte)).sum::<u32>();
    write_tar_checksum(&mut header[148..156], checksum);
    Ok(header)
}

fn split_tar_path(path: &str) -> Result<(&str, Option<&str>)> {
    if path.as_bytes().len() <= 100 {
        return Ok((path, None));
    }
    for index in path.match_indices('/').map(|(index, _)| index).rev() {
        let prefix = &path[..index];
        let name = &path[index + 1..];
        if !name.is_empty() && prefix.as_bytes().len() <= 155 && name.as_bytes().len() <= 100 {
            return Ok((name, Some(prefix)));
        }
    }
    bail!("archive path is too long for tar: {path}");
}

fn write_tar_bytes(field: &mut [u8], value: &[u8], label: &str) -> Result<()> {
    if value.len() > field.len() {
        bail!("{label} is too long");
    }
    field[..value.len()].copy_from_slice(value);
    Ok(())
}

fn write_tar_octal(field: &mut [u8], value: u64) -> Result<()> {
    let width = field.len();
    let encoded = format!("{value:0width$o}", width = width - 1);
    if encoded.len() > width - 1 {
        bail!("tar numeric field is too large: {value}");
    }
    field.fill(0);
    field[..encoded.len()].copy_from_slice(encoded.as_bytes());
    Ok(())
}

fn write_tar_checksum(field: &mut [u8], value: u32) {
    let encoded = format!("{value:06o}");
    field.fill(0);
    field[..encoded.len()].copy_from_slice(encoded.as_bytes());
    field[6] = 0;
    field[7] = b' ';
}

fn tar_padding(size: usize) -> usize {
    (512 - (size % 512)) % 512
}

fn safe_bundle_path_string(path: &str) -> Result<String> {
    let safe = safe_bundle_path(path)?;
    let parts = safe
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    Ok(parts.join("/"))
}

fn write_u16<W: Write>(writer: &mut W, value: u16) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn write_u32<W: Write>(writer: &mut W, value: u32) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            if crc & 1 == 1 {
                crc = (crc >> 1) ^ 0xedb8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn safe_bundle_path(path: &str) -> Result<PathBuf> {
    let parsed = Path::new(path);
    if parsed.is_absolute() {
        bail!("bundle artifact path must be relative: {path}");
    }
    let mut safe = PathBuf::new();
    for component in parsed.components() {
        match component {
            std::path::Component::Normal(part) => safe.push(part),
            std::path::Component::CurDir => {}
            _ => bail!("bundle artifact path is not safe: {path}"),
        }
    }
    if safe.as_os_str().is_empty() {
        bail!("bundle artifact path must not be empty");
    }
    Ok(safe)
}

fn decode_base64(input: &str) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut chunk: [u8; 4] = [0; 4];
    let mut chunk_len = 0usize;
    let mut padding = 0usize;
    let mut saw_padding = false;
    let mut finished = false;

    for byte in input.bytes().filter(|b| !b.is_ascii_whitespace()) {
        if finished {
            bail!("invalid base64 padding");
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                saw_padding = true;
                padding += 1;
                0
            }
            _ => bail!("invalid base64 character"),
        };
        if saw_padding && byte != b'=' {
            bail!("invalid base64 padding");
        }
        if padding > 2 {
            bail!("invalid base64 padding");
        }
        chunk[chunk_len] = value;
        chunk_len += 1;
        if chunk_len == 4 {
            output.push((chunk[0] << 2) | (chunk[1] >> 4));
            if padding < 2 {
                output.push((chunk[1] << 4) | (chunk[2] >> 2));
            }
            if padding == 0 {
                output.push((chunk[2] << 6) | chunk[3]);
            }
            chunk = [0; 4];
            chunk_len = 0;
            if padding > 0 {
                finished = true;
            }
            padding = 0;
            saw_padding = false;
        }
    }

    if chunk_len != 0 {
        bail!("invalid base64 length");
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_evidence_bundle() -> EvidenceExportBundle {
        EvidenceExportBundle {
            schema_version: "1.0".to_string(),
            bundle_type: "proveria_evidence_bundle".to_string(),
            generated_at: "2026-06-09T00:00:00Z".to_string(),
            manifest: json!({
                "export": {
                    "type": "evidence_export_job_manifest",
                    "counts": {
                        "attestations": 1,
                        "attempts": 1,
                        "verificationResults": 0,
                        "verificationLinks": 0,
                        "events": 2
                    }
                }
            }),
            artifacts: vec![
                EvidenceExportBundleArtifact {
                    path: "attestations/att_1/receipt.json".to_string(),
                    object_key: "tenants/t/receipt.json".to_string(),
                    content_type: "application/json".to_string(),
                    encoding: "base64".to_string(),
                    byte_size: 11,
                    body_base64: "eyJvayI6dHJ1ZX0=".to_string(),
                },
                EvidenceExportBundleArtifact {
                    path: "attestations/att_1/receipt.pdf".to_string(),
                    object_key: "tenants/t/receipt.pdf".to_string(),
                    content_type: "application/pdf".to_string(),
                    encoding: "base64".to_string(),
                    byte_size: 5,
                    body_base64: "JVBERgo=".to_string(),
                },
            ],
            missing_artifacts: vec![EvidenceExportBundleMissingArtifact {
                path: "attestations/att_2/receipt.pdf".to_string(),
                object_key: "tenants/t/missing.pdf".to_string(),
                reason: "not_found".to_string(),
            }],
        }
    }

    #[test]
    fn passage_hash_matches_browser_shingling_for_pdf_text() {
        let normalized = normalize_for_shingling(
            "A law firm may need to prove that a contract clause existed in the signed version of an agreement.",
        )
        .expect("normalizes");
        let tokens = tokenize_normalized(&normalized);
        let window_text = tokens[0][0..7].join(" ");
        let hash = shingle_payload_hash("standard", "pdf-text-layer/v1", &window_text);

        assert_eq!(
            hash,
            "76c18e4cee28d1ece2bf521aea85b32f6c365d02b8fd68fd4db5fa2c9bad2f3f"
        );
    }

    #[test]
    fn passage_candidates_require_a_continuous_seven_word_window() {
        let error = passage_candidate_hashes("one two three four five six")
            .expect_err("short passage should fail");

        assert!(
            error
                .to_string()
                .contains("at least 7 normalized words from one continuous passage")
        );
    }

    #[test]
    fn formats_public_api_error_envelope() {
        let body = r#"{
          "error": {
            "code": "idempotency_key_conflict",
            "message": "This Idempotency-Key was already used with a different request body.",
            "retryable": false,
            "requestId": "req_cli_1"
          }
        }"#;

        let formatted = format_api_error(StatusCode::CONFLICT, body);

        assert_eq!(
            formatted,
            "API request failed with HTTP 409 (idempotency_key_conflict): This Idempotency-Key was already used with a different request body. [not retryable; request id: req_cli_1]",
        );
    }

    #[test]
    fn formats_retryable_public_api_error_envelope() {
        let body = r#"{
          "error": {
            "code": "receipt_not_available",
            "message": "The receipt is not available yet.",
            "retryable": true,
            "requestId": "req_cli_2"
          }
        }"#;

        let formatted = format_api_error(StatusCode::ACCEPTED, body);

        assert_eq!(
            formatted,
            "API request failed with HTTP 202 (receipt_not_available): The receipt is not available yet. [retryable; request id: req_cli_2]",
        );
    }

    #[test]
    fn falls_back_for_non_json_error_body() {
        let formatted = format_api_error(StatusCode::BAD_GATEWAY, "upstream unavailable\n");

        assert_eq!(
            formatted,
            "API request failed with HTTP 502: upstream unavailable",
        );
    }

    #[test]
    fn project_idempotency_key_is_stable() {
        let first = project_idempotency_key("evaluation-workspace", "evidence", "Evidence");
        let second = project_idempotency_key("evaluation-workspace", "evidence", "Evidence");
        let different = project_idempotency_key("evaluation-workspace", "evidence-2", "Evidence");

        assert_eq!(first, second);
        assert_ne!(first, different);
        assert!(first.starts_with("cli-project-"));
    }

    #[test]
    fn access_grant_idempotency_key_normalizes_email() {
        let first =
            access_grant_idempotency_key("evaluation-workspace", "att_1", "Verifier@Example.com");
        let second =
            access_grant_idempotency_key("evaluation-workspace", "att_1", "verifier@example.com");

        assert_eq!(first, second);
        assert!(first.starts_with("cli-access-"));
    }

    #[test]
    fn evidence_export_request_body_maps_filters() {
        let body = evidence_export_request_body(
            Some("project_1".to_string()),
            Some("user_1".to_string()),
            true,
            Some(100),
        );

        assert_eq!(body.get("projectId"), Some(&json!("project_1")));
        assert_eq!(body.get("actorUserId"), Some(&json!("user_1")));
        assert_eq!(body.get("includeEvents"), Some(&json!(false)));
        assert_eq!(body.get("limit"), Some(&json!(100)));
    }

    #[test]
    fn evidence_export_idempotency_key_is_stable() {
        let mut body = serde_json::Map::new();
        body.insert("projectId".to_string(), json!("project_1"));
        body.insert("includeEvents".to_string(), json!(true));

        let first = evidence_export_idempotency_key("evaluation-workspace", &body);
        let second = evidence_export_idempotency_key("evaluation-workspace", &body);
        body.insert("limit".to_string(), json!(100));
        let different = evidence_export_idempotency_key("evaluation-workspace", &body);

        assert_eq!(first, second);
        assert_ne!(first, different);
        assert!(first.starts_with("cli-export-"));
    }

    #[test]
    fn canonical_json_sorts_object_keys_recursively() {
        let value = serde_json::json!({
            "b": 2,
            "a": {
                "z": false,
                "m": ["text", 1]
            }
        });

        assert_eq!(
            canonical_json(&value),
            r#"{"a":{"m":["text",1],"z":false},"b":2}"#
        );
    }

    #[test]
    fn compliance_json_metadata_hashes_canonical_object() {
        let path = std::env::temp_dir().join(format!(
            "proveria-compliance-{}-metadata.json",
            std::process::id()
        ));
        fs::write(&path, r#"{ "b": 2, "a": 1 }"#).expect("writes fixture");

        let metadata = compliance_json_metadata(&path).expect("builds metadata");

        assert_eq!(
            metadata.sha256,
            hex::encode(Sha256::digest(r#"{"a":1,"b":2}"#.as_bytes()))
        );
        assert_eq!(
            metadata.file_name,
            path.file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(metadata.byte_size, 13);
        assert_eq!(metadata.media_type, "application/json");
        assert_eq!(metadata.canonicalization, "json-stable-v1");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn dataset_inventory_template_extracts_api_metadata() {
        let template = dataset_inventory_template();
        let canonical = canonical_json(&template);
        let canonical_hash = hex::encode(Sha256::digest(canonical.as_bytes()));

        let metadata =
            dataset_inventory_metadata(&template, canonical_hash.clone()).expect("builds metadata");

        assert_eq!(metadata.provider, "dataset_inventory");
        assert_eq!(metadata.record_type, "dataset_inventory_record");
        assert_eq!(metadata.schema_version, "0.1");
        assert_eq!(metadata.canonical_hash, canonical_hash);
        assert_eq!(metadata.dataset_name, "Graduation Training Dataset");
        assert_eq!(metadata.dataset_version, "2026.06");
        assert_eq!(metadata.file_count, 2);
        assert_eq!(metadata.total_bytes, 1536);
        assert_eq!(metadata.data_classification, "confidential");
        assert_eq!(metadata.retention_rule.as_deref(), Some("7 years"));
    }

    #[test]
    fn collects_dataset_inventory_from_folder() {
        let root =
            std::env::temp_dir().join(format!("proveria-dataset-collect-{}", std::process::id()));
        let nested = root.join("nested");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&nested).expect("creates fixture dir");
        fs::write(root.join("a.txt"), b"alpha").expect("writes a");
        fs::write(nested.join("b.txt"), b"bravo").expect("writes b");

        let record = collect_dataset_inventory(&DatasetCollect {
            input: root.clone(),
            output: root.join("inventory.json"),
            name: "Fixture Dataset".to_string(),
            version: "v1".to_string(),
            scope: "folder".to_string(),
            classification: "internal".to_string(),
            source_owner: Some("Data Team".to_string()),
            license_usage_basis: None,
            retention_rule: Some("1 year".to_string()),
        })
        .expect("collects inventory");
        let metadata = dataset_inventory_package(&record)
            .expect("packages inventory")
            .metadata;

        assert_eq!(metadata.file_count, 2);
        assert_eq!(metadata.total_bytes, 10);
        assert_eq!(metadata.dataset_name, "Fixture Dataset");
        assert_eq!(metadata.source_owner.as_deref(), Some("Data Team"));
        assert_eq!(metadata.retention_rule.as_deref(), Some("1 year"));
        assert!(
            record["files"].as_array().unwrap()[0]["path"]
                .as_str()
                .unwrap()
                == "a.txt"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn builds_dataset_revision_record_from_inventory_records() {
        let base = json!({
            "record_type": "dataset_inventory_record",
            "schema_version": "0.1",
            "dataset": {
                "name": "Fixture Dataset",
                "version": "v1",
                "inventory_scope": "folder",
                "data_classification": "internal",
            },
            "summary": {
                "file_count": 3,
                "total_bytes": 30,
                "dataset_root_hash": "a".repeat(64),
                "hash_algorithm": "sha256",
            },
            "files": [
                { "path": "changed.txt", "sha256": "b".repeat(64), "byte_size": 10 },
                { "path": "removed.txt", "sha256": "c".repeat(64), "byte_size": 10 },
                { "path": "stable.txt", "sha256": "d".repeat(64), "byte_size": 10 }
            ]
        });
        let next = json!({
            "record_type": "dataset_inventory_record",
            "schema_version": "0.1",
            "dataset": {
                "name": "Fixture Dataset",
                "version": "v2",
                "inventory_scope": "folder",
                "data_classification": "internal",
            },
            "summary": {
                "file_count": 3,
                "total_bytes": 33,
                "dataset_root_hash": "e".repeat(64),
                "hash_algorithm": "sha256",
            },
            "files": [
                { "path": "changed.txt", "sha256": "f".repeat(64), "byte_size": 13 },
                { "path": "new.txt", "sha256": "1".repeat(64), "byte_size": 10 },
                { "path": "stable.txt", "sha256": "d".repeat(64), "byte_size": 10 }
            ]
        });

        let revision = build_dataset_revision_record(&base, &next).expect("builds revision");
        let package = dataset_revision_package(&revision).expect("packages revision");

        assert_eq!(package.metadata.provider, "dataset_revision");
        assert_eq!(package.metadata.record_type, "dataset_revision_record");
        assert_eq!(package.metadata.dataset_name, "Fixture Dataset");
        assert_eq!(package.metadata.previous_dataset_version, "v1");
        assert_eq!(package.metadata.next_dataset_version, "v2");
        assert_eq!(package.metadata.new_file_count, 1);
        assert_eq!(package.metadata.changed_file_count, 1);
        assert_eq!(package.metadata.removed_file_count, 1);
        assert_eq!(package.metadata.unchanged_file_count, 1);
        assert_eq!(revision["changes"]["new"][0]["path"], "new.txt");
        assert_eq!(revision["changes"]["changed"][0]["path"], "changed.txt");
        assert_eq!(revision["changes"]["removed"][0]["path"], "removed.txt");
        assert_eq!(revision["changes"]["unchanged"][0]["path"], "stable.txt");
    }

    #[test]
    fn model_release_template_extracts_api_metadata() {
        let template = model_release_template();
        let canonical = canonical_json(&template);
        let canonical_hash = hex::encode(Sha256::digest(canonical.as_bytes()));

        let metadata =
            model_release_metadata(&template, canonical_hash.clone()).expect("builds metadata");

        assert_eq!(metadata.provider, "model_release");
        assert_eq!(metadata.record_type, "model_provenance_record");
        assert_eq!(metadata.schema_version, "0.1");
        assert_eq!(metadata.canonical_hash, canonical_hash);
        assert_eq!(metadata.model_name, "Graduation Model");
        assert_eq!(metadata.model_version, "2026.06");
        assert_eq!(metadata.claim_type, "model_release_approved");
        assert_eq!(metadata.policy_id, "AI-GOV-001");
        assert_eq!(metadata.verification_policy, "verify_model_release_claim");
        assert_eq!(metadata.retention_period.as_deref(), Some("7 years"));
    }

    #[test]
    fn model_release_metadata_rejects_missing_required_fields() {
        let mut template = model_release_template();
        template["claim"]["subject_hash"] = json!("");

        let err = model_release_metadata(&template, "a".repeat(64)).expect_err("rejects record");

        assert!(err.to_string().contains("claim.subject_hash"));
    }

    #[test]
    fn unpacks_evidence_bundle_artifacts() {
        let output =
            std::env::temp_dir().join(format!("proveria-export-unpack-{}", std::process::id()));
        let _ = fs::remove_dir_all(&output);
        let bundle = sample_evidence_bundle();

        unpack_evidence_bundle(&bundle, &output).expect("unpacks bundle");

        let manifest = fs::read_to_string(output.join("manifest.json")).expect("reads manifest");
        assert!(manifest.contains("evidence_export_job_manifest"));
        assert_eq!(
            fs::read_to_string(output.join("attestations/att_1/receipt.json"))
                .expect("reads json artifact"),
            r#"{"ok":true}"#
        );
        assert_eq!(
            fs::read(output.join("attestations/att_1/receipt.pdf")).expect("reads pdf artifact"),
            b"%PDF\n"
        );
        let missing =
            fs::read_to_string(output.join("missing-artifacts.json")).expect("reads missing list");
        assert!(missing.contains("tenants/t/missing.pdf"));

        let _ = fs::remove_dir_all(output);
    }

    #[test]
    fn inspects_evidence_bundle_summary() {
        let bundle = sample_evidence_bundle();

        let inspection = inspect_evidence_bundle(&bundle).expect("inspects bundle");

        assert_eq!(inspection.bundle_type, "proveria_evidence_bundle");
        assert_eq!(inspection.artifact_count, 2);
        assert_eq!(inspection.missing_artifact_count, 1);
        assert_eq!(inspection.total_artifact_bytes, 16);
        assert_eq!(
            inspection.artifacts[0].path,
            "attestations/att_1/receipt.json"
        );
        assert_eq!(inspection.artifacts[1].content_type, "application/pdf");
        assert_eq!(
            inspection
                .manifest_counts
                .as_ref()
                .and_then(|counts| counts.get("attestations"))
                .and_then(|count| count.as_i64()),
            Some(1)
        );
    }

    #[test]
    fn checks_evidence_bundle_file() {
        let output = std::env::temp_dir().join(format!(
            "proveria-evidence-check-bundle-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&output);
        let bundle = sample_evidence_bundle();
        fs::write(
            &output,
            serde_json::to_vec_pretty(&bundle).expect("serializes bundle"),
        )
        .expect("writes bundle");

        let check = check_evidence_export_package(&output).expect("checks bundle file");

        assert!(check.valid);
        assert_eq!(check.kind, "bundle");
        assert_eq!(check.artifact_count, 2);
        assert_eq!(check.missing_artifact_count, 1);
        assert_eq!(check.total_artifact_bytes, 16);

        let _ = fs::remove_file(output);
    }

    #[test]
    fn checks_collected_evidence_directory() {
        let output = std::env::temp_dir().join(format!(
            "proveria-evidence-check-dir-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&output);
        let bundle = sample_evidence_bundle();
        fs::create_dir_all(&output).expect("creates output");
        fs::write(
            output.join("bundle.json"),
            serde_json::to_vec_pretty(&bundle).expect("serializes bundle"),
        )
        .expect("writes bundle");
        unpack_evidence_bundle(&bundle, &output).expect("unpacks bundle");

        let check = check_evidence_export_package(&output).expect("checks directory");

        assert!(check.valid);
        assert_eq!(check.kind, "directory");
        assert_eq!(check.artifact_count, 2);
        assert_eq!(check.missing_artifact_count, 1);
        assert!(check.checked_files.contains(&"bundle.json".to_string()));
        assert!(check.checked_files.contains(&"manifest.json".to_string()));
        assert!(
            check
                .checked_files
                .contains(&"attestations/att_1/receipt.json".to_string())
        );
        assert!(
            check
                .checked_files
                .contains(&"missing-artifacts.json".to_string())
        );

        let _ = fs::remove_dir_all(output);
    }

    #[test]
    fn rejects_collected_evidence_directory_with_corrupt_artifact() {
        let output = std::env::temp_dir().join(format!(
            "proveria-evidence-check-corrupt-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&output);
        let bundle = sample_evidence_bundle();
        fs::create_dir_all(&output).expect("creates output");
        fs::write(
            output.join("bundle.json"),
            serde_json::to_vec_pretty(&bundle).expect("serializes bundle"),
        )
        .expect("writes bundle");
        unpack_evidence_bundle(&bundle, &output).expect("unpacks bundle");
        fs::write(output.join("attestations/att_1/receipt.json"), b"corrupt")
            .expect("corrupts artifact");

        let error = check_evidence_export_package(&output).expect_err("rejects corrupt artifact");

        assert!(
            error
                .to_string()
                .contains("attestations/att_1/receipt.json does not match bundle payload")
        );

        let _ = fs::remove_dir_all(output);
    }

    #[test]
    fn builds_evidence_bundle_zip_entries() {
        let bundle = sample_evidence_bundle();

        let entries = evidence_bundle_zip_entries(&bundle).expect("builds zip entries");
        let paths = entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            vec![
                "bundle.json",
                "manifest.json",
                "attestations/att_1/receipt.json",
                "attestations/att_1/receipt.pdf",
                "missing-artifacts.json"
            ]
        );
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.path == "attestations/att_1/receipt.pdf")
                .map(|entry| entry.bytes.as_slice()),
            Some(b"%PDF\n".as_slice())
        );
    }

    #[test]
    fn writes_evidence_bundle_zip_archive() {
        let output = std::env::temp_dir().join(format!(
            "proveria-evidence-bundle-{}.zip",
            std::process::id()
        ));
        let _ = fs::remove_file(&output);
        let bundle = sample_evidence_bundle();

        write_evidence_bundle_zip(&bundle, &output).expect("writes zip");

        let bytes = fs::read(&output).expect("reads zip");
        assert!(bytes.starts_with(&0x0403_4b50u32.to_le_bytes()));
        assert!(
            bytes
                .windows("manifest.json".len())
                .any(|window| window == b"manifest.json")
        );
        assert!(
            bytes
                .windows("attestations/att_1/receipt.pdf".len())
                .any(|window| window == b"attestations/att_1/receipt.pdf")
        );
        assert!(
            bytes
                .windows(0x0605_4b50u32.to_le_bytes().len())
                .any(|window| window == 0x0605_4b50u32.to_le_bytes())
        );

        let _ = fs::remove_file(output);
    }

    #[test]
    fn writes_evidence_bundle_tar_archive() {
        let output = std::env::temp_dir().join(format!(
            "proveria-evidence-bundle-{}.tar",
            std::process::id()
        ));
        let _ = fs::remove_file(&output);
        let bundle = sample_evidence_bundle();

        write_evidence_bundle_tar(&bundle, &output).expect("writes tar");

        let bytes = fs::read(&output).expect("reads tar");
        assert!(bytes.len() >= 1024);
        assert_eq!(bytes.len() % 512, 0);
        assert_eq!(&bytes[257..263], b"ustar\0");
        assert!(
            bytes
                .windows("manifest.json".len())
                .any(|window| window == b"manifest.json")
        );
        assert!(
            bytes
                .windows("attestations/att_1/receipt.pdf".len())
                .any(|window| window == b"attestations/att_1/receipt.pdf")
        );
        assert!(bytes[bytes.len() - 1024..].iter().all(|byte| *byte == 0));

        let _ = fs::remove_file(output);
    }

    #[test]
    fn splits_long_tar_paths_into_prefix_and_name() {
        let path = "attestations/very-long-attestation-id-with-extra-path-segments/receipt-artifacts/evidence-package-files/final-receipt.json";

        let (name, prefix) = split_tar_path(path).expect("splits tar path");

        assert_eq!(name, "final-receipt.json");
        assert_eq!(
            prefix,
            Some(
                "attestations/very-long-attestation-id-with-extra-path-segments/receipt-artifacts/evidence-package-files"
            )
        );
    }

    #[test]
    fn crc32_matches_standard_fixture() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn rejects_unsafe_bundle_artifact_paths() {
        let output = std::env::temp_dir().join(format!(
            "proveria-export-unpack-unsafe-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&output);
        let bundle = EvidenceExportBundle {
            schema_version: "1.0".to_string(),
            bundle_type: "proveria_evidence_bundle".to_string(),
            generated_at: "2026-06-09T00:00:00Z".to_string(),
            manifest: json!({}),
            artifacts: vec![EvidenceExportBundleArtifact {
                path: "../receipt.json".to_string(),
                object_key: "tenants/t/receipt.json".to_string(),
                content_type: "application/json".to_string(),
                encoding: "base64".to_string(),
                byte_size: 2,
                body_base64: "e30=".to_string(),
            }],
            missing_artifacts: vec![],
        };

        let error = unpack_evidence_bundle(&bundle, &output).expect_err("rejects unsafe path");

        assert!(error.to_string().contains("not safe"));
        let _ = fs::remove_dir_all(output);
    }

    #[test]
    fn webhook_idempotency_keys_are_stable() {
        let mut body = serde_json::Map::new();
        body.insert(
            "url".to_string(),
            json!("https://example.com/proveria/webhooks"),
        );
        body.insert("events".to_string(), json!(["receipt.issued"]));

        let first = webhook_idempotency_key("evaluation-workspace", &body);
        let second = webhook_idempotency_key("evaluation-workspace", &body);
        let test = webhook_test_idempotency_key("evaluation-workspace", "endpoint_1");

        assert_eq!(first, second);
        assert!(first.starts_with("cli-webhook-"));
        assert!(test.starts_with("cli-webhook-test-"));
    }

    #[test]
    fn extracts_session_cookie_from_set_cookie_header() {
        let header = "proveria_session=s%3Aabc.def; Path=/; HttpOnly; SameSite=Lax";

        assert_eq!(
            extract_session_cookie(header),
            Some("proveria_session=s%3Aabc.def".to_string())
        );
    }

    #[test]
    fn ignores_unrelated_cookie_header() {
        let header = "other=value; Path=/; HttpOnly";

        assert_eq!(extract_session_cookie(header), None);
    }

    #[test]
    fn normalizes_api_key_scopes() {
        let scopes = normalize_api_key_scopes(vec![
            "READ".to_string(),
            "write".to_string(),
            "read".to_string(),
        ])
        .expect("valid scopes");

        assert_eq!(scopes, vec!["read".to_string(), "write".to_string()]);
    }

    #[test]
    fn api_key_expiration_duration_rejects_non_positive_values() {
        let error = api_key_expiration_from_duration("0d").expect_err("rejects zero days");

        assert!(error.to_string().contains("greater than zero"));
    }
}

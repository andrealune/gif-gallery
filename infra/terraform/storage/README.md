# infra/terraform/storage

Terraform for the GIF/file storage backing store described in L42-425: a
private, versioned, encrypted S3 bucket, a CloudFront distribution in front
of it (the public CDN), and a least-privilege IAM policy for the app.

## What this provisions

- **S3 bucket** – `BucketOwnerEnforced` (no ACLs), all public access blocked,
  versioning + SSE-S3 encryption on, lifecycle rules to abort stale
  multipart uploads and expire old object versions.
- **Bucket policy** – denies any non-TLS request; allows `s3:GetObject` only
  from the CloudFront distribution's Origin Access Control (no other public
  read path exists).
- **CloudFront distribution** (`enable_cdn = true`, default) – HTTPS-only,
  `Managed-CachingOptimized` cache policy, optional custom domain via
  `cdn_aliases` + `acm_certificate_arn`.
- **IAM** – an IAM user (optional; set `app_iam_user_name = null` to skip)
  scoped to `s3:PutObject`/`GetObject`/`DeleteObject`/`ListBucket` on this
  bucket only, for the app to use as `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`.
  Prefer an IAM role (instance profile / ECS task role) over long-lived keys
  once the app runs on AWS compute - attach an equivalent policy
  (`data.aws_iam_policy_document.app_bucket_access` in `main.tf`) to that
  role instead, and set `app_iam_user_name = null`.

This module is deliberately provider-agnostic at the *application* level:
`server/src/storage` also has a filesystem driver for local dev, and the S3
driver works against any S3-compatible endpoint (set `S3_ENDPOINT` /
`S3_FORCE_PATH_STYLE`), so the same code path works if a GCS/MinIO/R2 bucket
is used instead of this AWS module.

## Prerequisites

- Terraform >= 1.6.
- AWS credentials with permission to manage S3, CloudFront and IAM
  (e.g. via `AWS_PROFILE`/`AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` env
  vars - never commit these).
- A remote state backend. None is configured in `versions.tf` because the
  state bucket/table is account-specific; add one before the first real
  apply, e.g.:

  ```hcl
  # backend.tf (untracked, or filled in per environment - do not commit
  # account-specific values here without discussing the topology with the CTO)
  terraform {
    backend "s3" {
      bucket         = "<your-tfstate-bucket>"
      key            = "gif-gallery/storage/<environment>.tfstate"
      region         = "<region>"
      dynamodb_table = "<your-tflock-table>"
      encrypt        = true
    }
  }
  ```

## Applying, per environment

Each environment gets its own state (via the backend `key` above) and its
own `.tfvars` file (copy `terraform.tfvars.example`, which holds no secrets):

```bash
cd infra/terraform/storage
cp terraform.tfvars.example dev.tfvars   # then edit as needed; gitignored
terraform init
terraform plan  -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

After the first apply, read the generated app credentials once and store
them in the app's secret manager / `.env` (never in the repo):

```bash
terraform output app_access_key_id
terraform output -raw app_secret_access_key
terraform output cdn_domain_name   # -> CDN_BASE_URL=https://<this>
```

Set on the server: `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CDN_BASE_URL=https://<cdn_domain_name>`.

## Rollback

- **Config change to CDN/bucket (bad cache policy, bad CORS, etc.)**: `git
  revert` the Terraform commit and re-`apply` with the same `-var-file`.
  All resources here (bucket settings, CloudFront config, IAM policy) are
  updated in place - nothing is destroyed by a revert-and-reapply.
- **Bad CDN rollout that needs to stop serving immediately**: the fastest
  rollback is at the app level, not infra - unset/point `CDN_BASE_URL` back
  at a previous value (or unset it to fall back to direct-from-bucket URLs)
  and redeploy the app; this takes effect without touching Terraform.
  `terraform apply -var enable_cdn=false` also works but takes down the
  whole CDN, not just a bad config change, so prefer the app-level rollback
  first.
- **Accidental object deletion/overwrite**: versioning is enabled
  specifically for this - restore the previous version of the object from
  the S3 console/CLI (`aws s3api list-object-versions`), no Terraform
  involved.
- **Never run `terraform destroy` against staging/production** as a
  rollback: it deletes the bucket (and, unless every object version is
  removed first, will fail-safe rather than silently losing data - but
  don't rely on that). If a full teardown is genuinely required, that is an
  infrastructure-topology change and must go through the CTO per the
  DevOps escalation policy.

## Cost / topology note

Provisioning this module (an S3 bucket + a CloudFront distribution) changes
production infrastructure topology and incurs ongoing AWS cost (storage,
requests, CDN data transfer). The first `apply` against a staging/production
account should be reviewed with the CTO before running, per standard
DevOps practice; `enable_cdn`, `cloudfront_price_class` and region are the
main cost levers.

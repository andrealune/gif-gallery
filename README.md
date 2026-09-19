# gif-gallery

AI-powered GIF gallery website.

- [`server/`](server/) – backend API (Node.js + TypeScript + Express). See
  [`server/README.md`](server/README.md) for setup, environment variables and
  the file storage abstraction used for GIFs.
- [`infra/terraform/storage/`](infra/terraform/storage/) – Terraform for the
  S3 bucket + CloudFront CDN + IAM access policy backing GIF storage
  (`STORAGE_PROVIDER=s3`). See that directory's README for how to apply it
  per environment and how to roll back.

A frontend has not been added to this repository yet.

output "bucket_name" {
  description = "S3 bucket name. Set as S3_BUCKET on the app."
  value       = aws_s3_bucket.media.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "bucket_regional_domain_name" {
  value = aws_s3_bucket.media.bucket_regional_domain_name
}

output "cdn_domain_name" {
  description = "CloudFront domain. Set as CDN_BASE_URL=https://<this> on the app (or point cdn_aliases' custom domain at it)."
  value       = var.enable_cdn ? aws_cloudfront_distribution.media[0].domain_name : null
}

output "cdn_distribution_id" {
  value = var.enable_cdn ? aws_cloudfront_distribution.media[0].id : null
}

output "app_iam_user_name" {
  value = var.app_iam_user_name
}

output "app_access_key_id" {
  description = "Set as S3_ACCESS_KEY_ID on the app. Empty when app_iam_user_name is null."
  value       = var.app_iam_user_name != null ? aws_iam_access_key.app[0].id : null
}

output "app_secret_access_key" {
  description = "Set as S3_SECRET_ACCESS_KEY on the app. Sensitive: read it once with `terraform output -raw app_secret_access_key` and store it in the app's secret manager - never commit it."
  value       = var.app_iam_user_name != null ? aws_iam_access_key.app[0].secret : null
  sensitive   = true
}

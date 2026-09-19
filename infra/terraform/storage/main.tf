locals {
  bucket_name = coalesce(var.bucket_name, "gif-gallery-${var.environment}-media")

  tags = merge(var.tags, {
    Project     = "gif-gallery"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# --- S3 bucket: private, versioned, encrypted, no ACLs ---------------------

resource "aws_s3_bucket" "media" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }
}

# Deny any non-TLS access, and (when the CDN is enabled) allow CloudFront's
# Origin Access Control to read objects. This bucket otherwise has no public
# access and no per-object ACLs (BucketOwnerEnforced above).
locals {
  cloudfront_read_statement = var.enable_cdn ? [{
    Sid       = "AllowCloudFrontServicePrincipalReadOnly"
    Effect    = "Allow"
    Principal = { Service = "cloudfront.amazonaws.com" }
    Action    = "s3:GetObject"
    Resource  = "${aws_s3_bucket.media.arn}/*"
    Condition = {
      StringEquals = {
        "AWS:SourceArn" = aws_cloudfront_distribution.media[0].arn
      }
    }
  }] : []

  deny_insecure_transport_statement = {
    Sid       = "DenyInsecureTransport"
    Effect    = "Deny"
    Principal = "*"
    Action    = "s3:*"
    Resource  = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    Condition = {
      Bool = { "aws:SecureTransport" = "false" }
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat(local.cloudfront_read_statement, [local.deny_insecure_transport_statement])
  })

  depends_on = [aws_s3_bucket_public_access_block.media]
}

# --- CloudFront CDN ----------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = var.enable_cdn ? 1 : 0
  name                              = "${local.bucket_name}-oac"
  description                       = "OAC for the ${var.environment} gif-gallery media bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "media" {
  count = var.enable_cdn ? 1 : 0

  enabled             = true
  comment             = "gif-gallery ${var.environment} media CDN"
  default_root_object = ""
  price_class         = var.cloudfront_price_class
  aliases             = var.cdn_aliases

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "s3-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = local.tags
}

# --- Least-privilege IAM access for the app ---------------------------------
#
# For simple deployments (no AWS compute yet) we provision an IAM user
# scoped to only this bucket. Once the app runs on ECS/EC2/Lambda, prefer
# attaching aws_iam_role_policy (below, as a document you can attach to that
# role) to the compute's role instead and set app_iam_user_name = null.

data "aws_iam_policy_document" "app_bucket_access" {
  statement {
    sid       = "ObjectReadWriteDelete"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
}

resource "aws_iam_user" "app" {
  count = var.app_iam_user_name != null ? 1 : 0
  name  = var.app_iam_user_name
  tags  = local.tags
}

resource "aws_iam_user_policy" "app" {
  count  = var.app_iam_user_name != null ? 1 : 0
  name   = "${var.app_iam_user_name}-bucket-access"
  user   = aws_iam_user.app[0].name
  policy = data.aws_iam_policy_document.app_bucket_access.json
}

resource "aws_iam_access_key" "app" {
  count = var.app_iam_user_name != null ? 1 : 0
  user  = aws_iam_user.app[0].name
}

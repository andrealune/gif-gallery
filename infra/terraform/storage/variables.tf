variable "environment" {
  description = "Deployment environment name (e.g. dev, staging, production). Used to name/tag resources."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: dev, staging, production."
  }
}

variable "aws_region" {
  description = "AWS region for the bucket and IAM resources. CloudFront itself is global."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Explicit S3 bucket name. Defaults to \"gif-gallery-<environment>-media\" when null. Must be globally unique."
  type        = string
  default     = null
}

variable "cors_allowed_origins" {
  description = "Origins allowed to call the bucket directly (e.g. browser-based presigned uploads). Should match the deployed frontend origin(s); leave empty if the app always uploads server-side."
  type        = list(string)
  default     = []
}

variable "enable_cdn" {
  description = "Whether to provision a CloudFront distribution in front of the bucket. Should be true outside of throwaway/dev environments."
  type        = bool
  default     = true
}

variable "cloudfront_price_class" {
  description = "CloudFront price class (controls which edge locations are used and cost)."
  type        = string
  default     = "PriceClass_100"
}

variable "cdn_aliases" {
  description = "Custom domain names (CNAMEs) to serve the CDN on, e.g. [\"media.example.com\"]. Requires acm_certificate_arn."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (must exist in us-east-1) covering cdn_aliases. Leave null to use the default *.cloudfront.net certificate (no custom domain)."
  type        = string
  default     = null
}

variable "app_iam_user_name" {
  description = "Name of an IAM user created for the application to read/write the bucket. Set to null to skip creating a user, e.g. once the app runs on AWS compute and should assume an IAM role/instance profile instead (preferred - see README)."
  type        = string
  default     = null
}

variable "noncurrent_version_expiration_days" {
  description = "Days to keep noncurrent (overwritten/deleted) object versions before they are expired, since versioning is enabled for recovery."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Additional tags applied to all resources."
  type        = map(string)
  default     = {}
}

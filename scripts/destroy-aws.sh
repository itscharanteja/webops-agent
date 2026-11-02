#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# WebOps AI Agent - AWS Teardown & Resource Cleanup Script
# ==============================================================================

echo "=========================================================="
echo "  ⚠️  WebOps Agentic Workflow - AWS Teardown Script"
echo "=========================================================="
echo "This will permanently delete ALL WebOps AWS resources:"
echo "  • ECS Fargate Services & Cluster"
echo "  • Application Load Balancer (ALB) & Target Groups"
echo "  • Amazon RDS PostgreSQL Database (webops)"
echo "  • Amazon ElastiCache Redis Cluster"
echo "  • Amazon S3 Artifacts Bucket & all proof files"
echo "  • Amazon Cognito User Pool & App Client"
echo "  • Amazon ECR Container Repositories & Images"
echo "  • CloudWatch Log Groups & VPC Networking"
echo "=========================================================="

REGION="${AWS_REGION:-$(aws configure get region || echo 'ap-south-1')}"
REGION="${REGION:-ap-south-1}"
STACK_NAME="${STACK_NAME:-webops-prod}"

# Confirmation prompt unless passed -y / --yes / FORCE=1
if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--yes" ] && [ "${FORCE:-0}" != "1" ]; then
  read -p "Are you sure you want to delete all WebOps resources in $REGION? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Teardown aborted."
    exit 0
  fi
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "📍 Target Region: $REGION (Account: $ACCOUNT_ID)"

# Step 1: Empty S3 Artifacts Bucket (CloudFormation cannot delete non-empty buckets)
echo ""
echo "🗑️  Step 1: Checking and emptying S3 artifacts bucket..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactsBucketName'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -n "$BUCKET_NAME" ] && aws s3 ls "s3://${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "  Emptying S3 bucket s3://${BUCKET_NAME}..."
  aws s3 rm "s3://${BUCKET_NAME}" --recursive --region "$REGION" || true
else
  FALLBACK_BUCKET="${STACK_NAME}-artifacts-${ACCOUNT_ID}-${REGION}"
  if aws s3 ls "s3://${FALLBACK_BUCKET}" >/dev/null 2>&1; then
    echo "  Emptying S3 bucket s3://${FALLBACK_BUCKET}..."
    aws s3 rm "s3://${FALLBACK_BUCKET}" --recursive --region "$REGION" || true
  fi
fi

# Step 2: Delete CloudFormation Stack
echo ""
echo "☁️  Step 2: Deleting CloudFormation Stack ($STACK_NAME)..."
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  echo "  Waiting for stack deletion to complete (this takes ~5-8 minutes to cleanly terminate RDS/ElastiCache/ALB)..."
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
  echo "  Stack $STACK_NAME deleted successfully."
else
  echo "  Stack $STACK_NAME does not exist or was already deleted."
fi

# Step 3: Delete ECR Repositories
echo ""
echo "📦 Step 3: Deleting ECR Repositories and Container Images..."
for REPO in "webops-api" "webops-worker" "webops-web"; do
  if aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1; then
    echo "  Deleting ECR repo $REPO (including all image layers)..."
    aws ecr delete-repository --repository-name "$REPO" --force --region "$REGION" >/dev/null
  else
    echo "  ECR repo $REPO already absent."
  fi
done

echo ""
echo "=========================================================="
echo "  ✅ All WebOps AWS resources have been completely deleted!"
echo "  Zero running instances, databases, or storage remaining."
echo "=========================================================="

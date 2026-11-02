#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# WebOps AI Agent - AWS Production Deployment Script
# ==============================================================================

echo "=========================================================="
echo "  🚀 WebOps Agentic Workflow - AWS Deployment"
echo "=========================================================="

REGION="${AWS_REGION:-$(aws configure get region || echo 'ap-south-1')}"
REGION="${REGION:-ap-south-1}"
STACK_NAME="${STACK_NAME:-webops-prod}"
ENV_FILE="${ENV_FILE:-.env}"

echo "📍 Target Region: $REGION"

# Verify AWS CLI identity
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "🔑 AWS Account ID: $ACCOUNT_ID"

if [ -f "$ENV_FILE" ]; then
  echo "📄 Loading environment variables from $ENV_FILE..."
  set -a
  source "$ENV_FILE"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-}"
REDIS_URL="${REDIS_URL:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET:-}"
BEDROCK_REGION="${BEDROCK_REGION:-us-east-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-us.anthropic.claude-3-5-sonnet-20241022-v2:0}"

ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
API_REPO="webops-api"
WORKER_REPO="webops-worker"
WEB_REPO="webops-web"

# Step 1: Ensure ECR Repositories Exist
echo ""
echo "📦 Step 1: Verifying/Creating ECR Repositories in $REGION..."
for REPO in "$API_REPO" "$WORKER_REPO" "$WEB_REPO"; do
  if ! aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1; then
    echo "  Creating ECR repo $REPO..."
    aws ecr create-repository --repository-name "$REPO" --region "$REGION" --image-scanning-configuration scanOnPush=true >/dev/null
  else
    echo "  ECR repo $REPO exists."
  fi
done

# Step 2: ECR Login
echo ""
echo "🔐 Step 2: Logging in to Amazon ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_BASE"

# Step 3: Build & Push Container Images
echo ""
echo "🔨 Step 3: Building and pushing Docker container images..."

TAG="$(date +%Y%m%d%H%M%S)"
API_IMAGE="${ECR_BASE}/${API_REPO}:${TAG}"
WORKER_IMAGE="${ECR_BASE}/${WORKER_REPO}:${TAG}"
WEB_IMAGE="${ECR_BASE}/${WEB_REPO}:${TAG}"

API_LATEST="${ECR_BASE}/${API_REPO}:latest"
WORKER_LATEST="${ECR_BASE}/${WORKER_REPO}:latest"
WEB_LATEST="${ECR_BASE}/${WEB_REPO}:latest"

echo "  Building API image..."
docker build --platform linux/amd64 -f apps/api/Dockerfile -t "$API_IMAGE" -t "$API_LATEST" .
docker push "$API_IMAGE"
docker push "$API_LATEST"

echo "  Building Worker & Scanner image..."
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t "$WORKER_IMAGE" -t "$WORKER_LATEST" .
docker push "$WORKER_IMAGE"
docker push "$WORKER_LATEST"

echo "  Building Web image..."
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${SUPABASE_URL}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \
  -f apps/web/Dockerfile -t "$WEB_IMAGE" -t "$WEB_LATEST" .
docker push "$WEB_IMAGE"
docker push "$WEB_LATEST"

# Step 4: Deploy CloudFormation Stack
echo ""
echo "☁️  Step 4: Deploying CloudFormation Stack ($STACK_NAME)..."

if [ -z "$DATABASE_URL" ] || [ -z "$REDIS_URL" ]; then
  echo "⚠️  DATABASE_URL or REDIS_URL not set in environment."
  echo "   Please supply DATABASE_URL, REDIS_URL, SUPABASE_URL, etc., in your .env file."
  echo "   Skipping CloudFormation stack deployment until credentials are provided."
  echo "   Images have been pushed to ECR: $API_LATEST, $WORKER_LATEST, $WEB_LATEST"
  exit 0
fi

aws cloudformation deploy \
  --template-file infra/aws/cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName="$STACK_NAME" \
    DatabaseUrl="$DATABASE_URL" \
    RedisUrl="$REDIS_URL" \
    SupabaseUrl="$SUPABASE_URL" \
    SupabaseAnonKey="$SUPABASE_ANON_KEY" \
    SupabaseServiceRoleKey="$SUPABASE_SERVICE_ROLE_KEY" \
    SupabaseJwtSecret="$SUPABASE_JWT_SECRET" \
    BedrockRegion="$BEDROCK_REGION" \
    BedrockModelId="$BEDROCK_MODEL_ID" \
    ApiImageUri="$API_LATEST" \
    WorkerImageUri="$WORKER_LATEST" \
    WebImageUri="$WEB_LATEST"

echo ""
echo "🎉 Deployment complete! Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs" \
  --output table

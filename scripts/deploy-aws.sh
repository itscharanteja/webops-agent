#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# WebOps AI Agent - 100% AWS Production Deployment Script
# ==============================================================================

echo "=========================================================="
echo "  🚀 WebOps Agentic Workflow - AWS Production Deployment"
echo "=========================================================="

REGION="${AWS_REGION:-$(aws configure get region || echo 'ap-south-1')}"
REGION="${REGION:-ap-south-1}"
STACK_NAME="${STACK_NAME:-webops-prod}"
: "${DB_PASSWORD:?Set DB_PASSWORD before deploying}"
BEDROCK_REGION="${BEDROCK_REGION:-ap-south-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-apac.amazon.nova-lite-v1:0}"

echo "📍 Target Region: $REGION"

# Verify AWS CLI identity
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "🔑 AWS Account ID: $ACCOUNT_ID"

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
echo "🔨 Step 3: Building and pushing Docker container images (linux/amd64)..."

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
docker build --platform linux/amd64 -f apps/web/Dockerfile -t "$WEB_IMAGE" -t "$WEB_LATEST" .
docker push "$WEB_IMAGE"
docker push "$WEB_LATEST"

# Step 4: Deploy CloudFormation Stack
echo ""
echo "☁️  Step 4: Deploying All-In-One CloudFormation Stack ($STACK_NAME)..."
echo "    Provisioning VPC, RDS Postgres, ElastiCache Redis, S3, Cognito, ALB, and ECS Fargate..."

aws cloudformation deploy \
  --template-file infra/aws/cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName="$STACK_NAME" \
    DBPassword="$DB_PASSWORD" \
    BedrockRegion="$BEDROCK_REGION" \
    BedrockModelId="$BEDROCK_MODEL_ID" \
    ApiImageUri="$API_LATEST" \
    WorkerImageUri="$WORKER_LATEST" \
    WebImageUri="$WEB_LATEST"

echo ""
echo "🎉 CloudFormation Stack Deployed! Retrieving stack outputs..."

DB_HOST=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text)

ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerUrl'].OutputValue" \
  --output text)

COGNITO_POOL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" \
  --output text)

COGNITO_CLIENT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoClientId'].OutputValue" \
  --output text)

# The API applies checked-in migrations during startup over its private VPC connection.
# The deploy machine must not connect directly to the private RDS instance.

echo ""
echo "=========================================================="
echo "  🎉 WebOps AI Agent Successfully Deployed to AWS!"
echo "=========================================================="
echo "  Web Application URL: $ALB_URL"
echo "  Cognito User Pool:   $COGNITO_POOL"
echo "  Cognito Client ID:   $COGNITO_CLIENT"
echo "  RDS PostgreSQL Host: $DB_HOST"
echo "=========================================================="

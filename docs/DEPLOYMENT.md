# Deployment Guide: Replit → Flight Control → AWS

This guide explains how to deploy the Sirius application using a Replit development, Flight Control CI/CD, and AWS production pipeline.

## Overview

```
┌─────────────┐     ┌──────────┐     ┌────────────────┐     ┌─────────────┐
│   Replit    │ ──► │  GitHub  │ ──► │ Flight Control │ ──► │  AWS (ECS)  │
│ Development │     │   Repo   │     │   CI/CD        │     │  Production │
└─────────────┘     └──────────┘     └────────────────┘     └─────────────┘
```

## Prerequisites

1. **Replit Account** - For development environment
2. **GitHub Account** - For source code repository
3. **Flight Control Account** - Sign up at https://app.flightcontrol.dev
4. **AWS Account** - For production infrastructure
5. **Neon Account** - For production database (https://neon.tech)

## Architecture

### Development (Replit)
- Uses Replit Auth for authentication
- Connects to Replit-managed PostgreSQL (Neon-backed)
- Hot reloading with Vite
- Port 5000 for the application

### Production (AWS via Flight Control)
- Containerized deployment on AWS ECS/Fargate
- Neon PostgreSQL for database (same driver, different instance)
- AWS ALB for load balancing with HTTPS
- Port 8080 internally (mapped to 443 externally)

## Setup Steps

### 1. Connect GitHub Repository

Push your Replit project to GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create Neon Production Database

1. Sign up at https://neon.tech
2. Create a new project
3. Copy the connection string (starts with `postgresql://`)
4. This will be your production `DATABASE_URL`

### 3. Configure Flight Control

1. Sign in to https://app.flightcontrol.dev
2. Create a new project
3. Connect your GitHub repository
4. Connect your AWS account (follow Flight Control's AWS setup wizard)
5. Select the repository and branch to deploy

### 4. Configure Environment Variables

In Flight Control dashboard, add these secrets:

**Required:**
- `DATABASE_URL` - Your Neon production connection string
- `SESSION_SECRET` - Secure random string (min 32 chars)
- `PORT` - Set to `8080`
- `NODE_ENV` - Set to `production`

**For Initial Pipeline Testing (Tracer Bullet):**
- `MOCK_USER` - Set to `true`
- `MOCK_USER_EMAIL` - Email of a user in your database
- `ALLOW_MOCK_IN_PROD` - Set to `true` (temporary, for testing only!)

**Optional Services:**
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
- `SENDGRID_API_KEY`

### 5. Deploy

Once configured, Flight Control will:
1. Build the Docker image
2. Push to AWS ECR
3. Deploy to AWS ECS/Fargate
4. Configure load balancer and SSL
5. Run health checks

## Authentication Strategy

### Phase 1: Development (Replit Auth)
Uses Replit's OIDC provider. Works automatically when running on Replit.

### Phase 2: Pipeline Testing (Mock User)
For initial "tracer bullet" testing of the deployment pipeline:

1. Set these environment variables in Flight Control:
   ```
   MOCK_USER=true
   MOCK_USER_EMAIL=your-admin@example.com
   ALLOW_MOCK_IN_PROD=true
   ```

2. This bypasses authentication and uses a hardcoded user from your database
3. **Important**: Only use this temporarily to verify the pipeline works!

### Phase 3: Production (Real Auth)
After the pipeline is verified:
1. Remove `MOCK_USER`, `MOCK_USER_EMAIL`, and `ALLOW_MOCK_IN_PROD`
2. Implement proper authentication (Auth0, Cognito, etc.)
3. Update the auth module to support your chosen provider

## Database

### Development
- Uses Replit's PostgreSQL (Neon-backed)
- Connection via `DATABASE_URL` (auto-configured)

### Production
- Create a separate Neon project for production
- Use the Neon connection string as `DATABASE_URL`
- Same driver, no code changes needed
- Benefits: Serverless scaling, branching, connection pooling

## Configuration Files

### flightcontrol.json
Defines environments, services, and deployment configuration.

### Dockerfile
Multi-stage build that:
1. Installs all dependencies and builds the app
2. Creates a slim production image with only runtime dependencies

## Health Checks

- Endpoint: `/api/health`
- Returns server status, uptime, environment
- Used by AWS ALB for health monitoring

## Troubleshooting

### Build Failures
- Check Flight Control build logs
- Verify all dependencies in package.json
- Ensure Dockerfile syntax is correct

### Runtime Errors
- Check application logs in Flight Control
- Verify all environment variables are set
- Check database connectivity

### Auth Issues with Mock Mode
- Ensure `MOCK_USER_EMAIL` matches an existing user in the database
- Check that `ALLOW_MOCK_IN_PROD=true` is set
- Look for auth warnings in the logs

### Health Check Failures
- Verify `/api/health` endpoint responds
- Check application startup logs
- Ensure PORT is set to 8080

## Security Notes

1. **Mock User Mode**: Only use for initial pipeline testing
2. **Session Secret**: Use a long, random string (32+ chars)
3. **Database**: Use separate Neon projects for dev and prod
4. **Remove mock settings** before going live with real users

## Costs

### Flight Control
- Free tier available
- Starter: $49/month

### AWS (Pay-as-you-go)
- ECS/Fargate compute costs
- ALB costs
- Data transfer

### Neon
- Free tier: 0.5 GB storage
- Pro: $19/month for more resources

Estimated total: ~$50-100/month for small-medium workloads.

## Next Steps After Pipeline Verification

1. Remove mock auth settings
2. Implement production authentication (Auth0 recommended)
3. Set up monitoring and alerting
4. Configure custom domain
5. Set up staging environment

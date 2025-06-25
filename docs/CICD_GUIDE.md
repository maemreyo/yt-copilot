# 🚀 CI/CD Setup Guide

This guide will help you configure the comprehensive CI/CD pipeline for your Lean SaaS Starter project.

## 📋 Quick Setup Checklist

- [ ] Configure GitHub repository secrets
- [ ] Set up Supabase production project
- [ ] Configure external integrations (optional)
- [ ] Test CI/CD pipeline
- [ ] Set up monitoring and alerts

## 🔐 Required GitHub Secrets

Navigate to your GitHub repository → Settings → Secrets and variables → Actions, then add these secrets:

### Essential Secrets (Required)

```bash
# Supabase Production
SUPABASE_ACCESS_TOKEN=sbp_xxxxx...        # From Supabase Dashboard → Settings → Access Tokens
SUPABASE_PROJECT_ID=abcdefghijklmnop      # From your Supabase project URL

# Stripe (if using billing)
STRIPE_SECRET_KEY=sk_live_xxxxx...        # Production secret key from Stripe Dashboard
STRIPE_WEBHOOK_SECRET=whsec_xxxxx...      # From Stripe Dashboard → Webhooks
```

### Optional Secrets (For Enhanced Features)

```bash
# Security Scanning
SNYK_TOKEN=xxxxx...                       # From Snyk Dashboard → Settings → API Token

# Code Coverage
CODECOV_TOKEN=xxxxx...                    # From Codecov Dashboard → Settings → Repository

# Error Monitoring  
SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
SENTRY_AUTH_TOKEN=xxxxx...                # For Sentry releases integration

# Notifications (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## 🏗️ Supabase Production Setup

### 1. Create Production Project

1. Go to [Supabase Dashboard](https://app.supabase.io)
2. Click "New Project"
3. Choose organization and set project details
4. Wait for project creation to complete

### 2. Get Required Credentials

```bash
# Project Settings → General
SUPABASE_PROJECT_ID="your-project-id"        # From project URL

# Project Settings → API  
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Account Settings → Access Tokens → Create new token
SUPABASE_ACCESS_TOKEN="sbp_xxxxx..."
```

### 3. Configure Database

```bash
# Link your local project to production
supabase login
supabase link --project-ref your-project-id

# Deploy initial schema (optional - CI/CD will handle this)
supabase db push
```

## 🔧 External Integrations Setup

### Snyk Security Scanning (Optional)

1. Sign up at [Snyk.io](https://snyk.io)
2. Go to Settings → General → Auth Token
3. Copy token to GitHub Secrets as `SNYK_TOKEN`

### Codecov Coverage Reporting (Optional)

1. Sign up at [Codecov.io](https://codecov.io)
2. Add your GitHub repository
3. Copy upload token to GitHub Secrets as `CODECOV_TOKEN`

### Sentry Error Monitoring (Optional)

1. Sign up at [Sentry.io](https://sentry.io)
2. Create new project → Select "Node.js"
3. Copy DSN to GitHub Secrets as `SENTRY_DSN`
4. Generate Auth Token for releases: Settings → Auth Tokens → `SENTRY_AUTH_TOKEN`

## 🧪 Testing Your CI/CD Pipeline

### 1. Test CI Pipeline

Create a test pull request:

```bash
git checkout -b test-ci-pipeline
echo "# Test CI" >> TEST.md
git add TEST.md
git commit -m "test: verify CI pipeline"
git push origin test-ci-pipeline
```

Open PR and verify all checks pass:
- ✅ Code Quality & Linting
- ✅ Security Scanning  
- ✅ Unit Tests
- ✅ Integration Tests
- ✅ Build Verification
- ✅ Test Coverage
- ✅ Quality Gate

### 2. Test Deployment Pipeline

Merge PR to main branch and verify:
- ✅ Pre-deployment Checks
- ✅ Quick Validation
- ✅ Backend Deployment
- ✅ Post-deployment Monitoring

### 3. Verify Production Deployment

Check your production API:

```bash
# Replace with your Supabase project URL
curl https://your-project.supabase.co/functions/v1/core_health-check

# Should return healthy status
{
  "status": "healthy",
  "timestamp": "2025-06-24T12:00:00Z",
  "services": {
    "database": { "status": "ok", "latency": 45 },
    "cache": { "status": "ok" }
  }
}
```

## 📊 Monitoring Your CI/CD

### GitHub Actions Dashboard

Monitor your workflows at:
```
https://github.com/yourusername/your-repo/actions
```

Key metrics to watch:
- **Success Rate**: Should be >95%
- **Build Time**: Target <10 minutes for CI, <5 minutes for deployment
- **Test Coverage**: Should be >90%

### Workflow Notifications

Set up notifications for failed workflows:

1. Go to repository Settings → Notifications
2. Enable "Actions" notifications
3. Choose email/Slack/Discord integration

## 🚨 Troubleshooting Common Issues

### CI Pipeline Fails

```bash
# Check common issues:

# 1. Dependencies not installing
- Verify pnpm-lock.yaml is committed
- Check Node.js version compatibility

# 2. Tests failing
- Run tests locally first: pnpm test
- Check test database setup

# 3. Build failing
- Verify all imports are correct
- Check TypeScript configuration
```

### Deployment Fails

```bash
# Common deployment issues:

# 1. Supabase authentication
- Verify SUPABASE_ACCESS_TOKEN is correct
- Check token hasn't expired

# 2. Database migration issues
- Check migration syntax in SQL files
- Verify migration dependencies

# 3. Function deployment fails
- Check function syntax
- Verify import paths
```

### Security Scans Failing

```bash
# Security issues:

# 1. High/Critical vulnerabilities
- Run: pnpm audit --fix
- Update vulnerable dependencies

# 2. CodeQL issues
- Review security alerts in GitHub
- Fix reported security issues

# 3. Secrets exposed
- Check for hardcoded secrets
- Use environment variables
```

## 🔄 Maintenance

### Weekly Tasks

```bash
# 1. Review dependency updates from Dependabot
# 2. Check security scan results
# 3. Monitor deployment success rate
# 4. Review test coverage reports
```

### Monthly Tasks

```bash
# 1. Update CI/CD pipeline configurations
# 2. Review and rotate secrets
# 3. Audit security configurations
# 4. Performance optimization review
```

## 🚀 Advanced Configuration

### Custom Environment Variables

Add environment-specific variables in GitHub:

```bash
# Repository Settings → Environments → Create environment
# Name: "production" or "staging"

# Environment-specific secrets:
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
MONITORING_API_KEY=xxxxx...
```

### Deployment Slots

Configure staging deployment:

```bash
# In workflow dispatch, choose "staging" environment
# This deploys to a separate Supabase project for testing
```

### Custom Notifications

Add custom Slack notifications:

```yaml
# Add to deployment workflow
- name: Notify Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli)
- [CI/CD Best Practices](https://docs.github.com/en/actions/learn-github-actions/workflow-syntax-for-github-actions)

---

## ✅ Setup Complete!

Once configured, your CI/CD pipeline will:

- ✅ **Automatically test** every PR
- ✅ **Deploy to production** on main branch pushes  
- ✅ **Scan for security issues** weekly
- ✅ **Update dependencies** automatically
- ✅ **Monitor deployment health** continuously

Your SaaS is now production-ready with enterprise-grade CI/CD! 🚀
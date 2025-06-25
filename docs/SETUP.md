# Setup Guide

This guide will walk you through setting up the Lean Supabase SaaS Starter for local development and deploying it to production.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Docker (for local Supabase)
- Supabase CLI
- Git

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/lean-saas-starter.git
cd lean-saas-starter
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your local Supabase credentials and other required variables.

### 4. Start Supabase Locally

```bash
pnpm db:start
```

This will start a local Supabase instance using Docker. The first time you run this, it will take some time to download the necessary Docker images.

### 5. Apply Migrations and Seed Data

```bash
pnpm build:backend
pnpm db:seed:dev
```

This will sync your modules to Supabase and seed the database with development data.

### 6. Start the Development Server

```bash
pnpm dev:full
```

This will start the Next.js frontend, Supabase Edge Functions, and watch for changes.

## Production Deployment

### 1. Set Up Supabase Project

1. Create a new Supabase project at [https://app.supabase.io](https://app.supabase.io)
2. Get your project API keys and URL from the Supabase dashboard

### 2. Set Up GitHub Repository

1. Create a new GitHub repository
2. Add the following secrets to your repository:
   - `SUPABASE_ACCESS_TOKEN`: Your Supabase access token
   - `SUPABASE_PROJECT_ID`: Your Supabase project ID
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase project anonymous key

### 3. Deploy Backend to Supabase

The GitHub Actions workflow will automatically deploy your backend to Supabase when you push to the main branch.

Alternatively, you can deploy manually:

```bash
pnpm deploy:prod:backend
```

### 4. Deploy Frontend to Vercel

1. Create a new Vercel project
2. Link it to your GitHub repository
3. Set the following environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase project anonymous key
   - `STRIPE_SECRET_KEY`: Your Stripe secret key
   - `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook secret
   - `RESEND_API_KEY`: Your Resend API key

4. Deploy the frontend:

```bash
vercel --prod
```

## Additional Setup

### Stripe Integration

1. Create a Stripe account at [https://stripe.com](https://stripe.com)
2. Get your API keys from the Stripe dashboard
3. Set up a webhook endpoint in Stripe pointing to `https://yourdomain.com/api/webhooks/stripe`
4. Add the Stripe webhook secret to your environment variables

### Email Integration with Resend

1. Create a Resend account at [https://resend.com](https://resend.com)
2. Get your API key from the Resend dashboard
3. Add the Resend API key to your environment variables
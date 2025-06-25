# Lean Supabase SaaS Starter Documentation

Welcome to the documentation for the Lean Supabase SaaS Starter. This documentation will help you understand the architecture, setup process, and how to use the various features of the starter kit.

## Table of Contents

- [Setup Guide](SETUP.md) - How to set up the project locally and deploy it to production
- [Architecture Overview](ARCHITECTURE.md) - Overview of the project architecture and design decisions
- [API Documentation](API.md) - Documentation for the API endpoints
- [Architecture Decision Records (ADRs)](ADRs/) - Detailed explanations of key architectural decisions

## Core Philosophy

The Lean Supabase SaaS Starter is built on the following core principles:

1. **API-First is Supreme**: Backend is a standalone, stateless, "headless" API product. All features are exposed through well-defined API endpoints to serve any client (Web, Mobile, Extension, Server-to-Server).

2. **Module-First Architecture**: Backend code is organized into independent feature modules (e.g., billing, auth). Each module contains its own migrations, functions, and tests, ensuring high cohesion and low coupling.

3. **Supabase-First**: Maximizes the use of Supabase managed services (Postgres, Auth, Storage, Edge Functions). Treats Supabase as a platform, not just a library.

4. **Security by Default**: Row Level Security (RLS) is ENABLED on all tables containing user data. No access is granted by default.

5. **Superior Developer Experience (DevEx)**: Automates repetitive tasks through a powerful set of scripts. Provides a clear workflow from local development to production deployment.

6. **Zero-Ops Infrastructure**: No requirement for developers to manage servers, databases, or containers in production.

## Getting Started

To get started with the Lean Supabase SaaS Starter, follow the [Setup Guide](SETUP.md).
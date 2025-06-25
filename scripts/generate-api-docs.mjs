#!/usr/bin/env node

/**
 * Enhanced API Documentation Generator
 * 
 * This script:
 * 1. Discovers all OpenAPI spec files from modules
 * 2. Merges them into a comprehensive API specification
 * 3. Generates beautiful HTML documentation using Swagger UI
 * 4. Includes proper error handling and validation
 * 5. Supports both YAML and JSON OpenAPI specs
 * 6. Creates a complete documentation website
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const modulesDir = path.join(rootDir, 'src', 'modules');
const docsDir = path.join(rootDir, 'docs', 'generated');

// Logging utilities
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  warning: (msg) => console.log(`⚠️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  header: (msg) => {
    console.log('');
    console.log(`📚 ${msg}`);
    console.log('─'.repeat(50));
  }
};

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    log.info(`Created docs directory: ${docsDir}`);
  }
}

/**
 * Check if yaml package is available
 */
function validateDependencies() {
  try {
    // Check if js-yaml is available
    const yamlPackage = await import('js-yaml');
    log.success('Dependencies validation passed');
    return true;
  } catch (error) {
    log.error('js-yaml package not found. Please install it:');
    log.error('  pnpm add js-yaml');
    return false;
  }
}

/**
 * Find all OpenAPI specification files
 */
function findOpenApiSpecs() {
  const specs = [];
  
  function searchDirectory(dir, module = null) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules and other irrelevant directories
          if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            searchDirectory(fullPath, module || entry.name);
          }
        } else if (isOpenApiFile(entry.name)) {
          specs.push({
            file: fullPath,
            module: module || 'root',
            name: entry.name
          });
        }
      }
    } catch (error) {
      log.warning(`Could not read directory ${dir}: ${error.message}`);
    }
  }
  
  // Search in modules directory
  if (fs.existsSync(modulesDir)) {
    searchDirectory(modulesDir);
  }
  
  // Also search for a root-level OpenAPI spec
  const rootSpecs = ['openapi.yaml', 'openapi.yml', 'openapi.json'];
  for (const specFile of rootSpecs) {
    const specPath = path.join(rootDir, specFile);
    if (fs.existsSync(specPath)) {
      specs.push({
        file: specPath,
        module: 'root',
        name: specFile
      });
    }
  }
  
  return specs;
}

/**
 * Check if a file is an OpenAPI specification
 */
function isOpenApiFile(filename) {
  const openApiPatterns = [
    /^openapi\.(yaml|yml|json)$/i,
    /^swagger\.(yaml|yml|json)$/i,
    /^api-spec\.(yaml|yml|json)$/i
  ];
  
  return openApiPatterns.some(pattern => pattern.test(filename));
}

/**
 * Load and parse an OpenAPI spec file
 */
function loadOpenApiSpec(specPath) {
  try {
    const content = fs.readFileSync(specPath, 'utf8');
    const extension = path.extname(specPath).toLowerCase();
    
    let spec;
    if (extension === '.json') {
      spec = JSON.parse(content);
    } else {
      spec = yaml.load(content);
    }
    
    // Validate basic OpenAPI structure
    if (!spec || typeof spec !== 'object') {
      throw new Error('Invalid OpenAPI spec: not an object');
    }
    
    if (!spec.openapi && !spec.swagger) {
      throw new Error('Invalid OpenAPI spec: missing openapi or swagger field');
    }
    
    return spec;
    
  } catch (error) {
    throw new Error(`Failed to load ${specPath}: ${error.message}`);
  }
}

/**
 * Create a base OpenAPI specification
 */
function createBaseSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Lean SaaS Starter API',
      version: '1.0.0',
      description: `
# Lean SaaS Starter API Documentation

This is the comprehensive API documentation for the Lean SaaS Starter. 

## Authentication

This API uses multiple authentication methods:

- **Bearer Token**: For user authentication (JWT tokens)
- **API Key**: For server-to-server communication  

## Rate Limiting

All endpoints are rate limited. See individual endpoint documentation for specific limits.

## Error Handling

All errors follow a consistent format:

\`\`\`json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {}
  }
}
\`\`\`

## Modules

This API is organized into modules:

- **Core**: Health checks, version info, and system endpoints
- **Auth**: User authentication and API key management  
- **Billing**: Stripe integration and subscription management
      `,
      contact: {
        name: 'API Support',
        email: 'support@example.com',
        url: 'https://github.com/yourusername/lean-saas-starter'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:54321/functions/v1',
        description: 'Local development server'
      },
      {
        url: 'https://your-project.supabase.co/functions/v1',
        description: 'Production server'
      }
    ],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for user authentication'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for server-to-server authentication'
        }
      },
      parameters: {
        limitParam: {
          name: 'limit',
          in: 'query',
          description: 'Maximum number of items to return',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20
          }
        },
        offsetParam: {
          name: 'offset',
          in: 'query',
          description: 'Number of items to skip for pagination',
          schema: {
            type: 'integer',
            minimum: 0,
            default: 0
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', example: 'UNAUTHORIZED' },
                      message: { type: 'string', example: 'Authentication required' }
                    }
                  }
                }
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', example: 'FORBIDDEN' },
                      message: { type: 'string', example: 'Insufficient permissions' }
                    }
                  }
                }
              }
            }
          }
        },
        RateLimitError: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
                      message: { type: 'string', example: 'Rate limit exceeded' }
                    }
                  }
                }
              }
            }
          }
        },
        ValidationError: {
          description: 'Invalid request data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', example: 'VALIDATION_ERROR' },
                      message: { type: 'string', example: 'Invalid request data' },
                      details: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Core',
        description: 'System health and information endpoints'
      },
      {
        name: 'Auth',
        description: 'Authentication and API key management'
      },
      {
        name: 'Billing',
        description: 'Stripe integration and subscription management'
      },
      {
        name: 'Webhooks',
        description: 'External service webhooks'
      }
    ]
  };
}

/**
 * Merge multiple OpenAPI specifications
 */
function mergeOpenApiSpecs(specFiles) {
  const mergedSpec = createBaseSpec();
  const moduleInfo = [];
  
  log.info(`Merging ${specFiles.length} OpenAPI specifications...`);
  
  for (const specFile of specFiles) {
    try {
      log.info(`  Processing: ${specFile.module}/${specFile.name}`);
      
      const spec = loadOpenApiSpec(specFile.file);
      moduleInfo.push({
        module: specFile.module,
        file: specFile.name,
        pathCount: Object.keys(spec.paths || {}).length
      });
      
      // Merge paths
      if (spec.paths) {
        for (const [pathKey, pathValue] of Object.entries(spec.paths)) {
          if (mergedSpec.paths[pathKey]) {
            log.warning(`    Path conflict: ${pathKey} (merging methods)`);
            // Merge HTTP methods
            mergedSpec.paths[pathKey] = {
              ...mergedSpec.paths[pathKey],
              ...pathValue
            };
          } else {
            mergedSpec.paths[pathKey] = pathValue;
          }
        }
      }
      
      // Merge components
      if (spec.components) {
        const { schemas, parameters, responses, examples, requestBodies, headers, links, callbacks } = spec.components;
        
        if (schemas) {
          mergedSpec.components.schemas = { ...mergedSpec.components.schemas, ...schemas };
        }
        if (parameters) {
          mergedSpec.components.parameters = { ...mergedSpec.components.parameters, ...parameters };
        }
        if (responses) {
          mergedSpec.components.responses = { ...mergedSpec.components.responses, ...responses };
        }
        if (examples) {
          mergedSpec.components.examples = { ...mergedSpec.components.examples, ...examples };
        }
        if (requestBodies) {
          mergedSpec.components.requestBodies = { ...mergedSpec.components.requestBodies, ...requestBodies };
        }
        if (headers) {
          mergedSpec.components.headers = { ...mergedSpec.components.headers, ...headers };
        }
        if (links) {
          mergedSpec.components.links = { ...mergedSpec.components.links, ...links };
        }
        if (callbacks) {
          mergedSpec.components.callbacks = { ...mergedSpec.components.callbacks, ...callbacks };
        }
      }
      
      // Merge tags
      if (spec.tags) {
        const existingTagNames = mergedSpec.tags.map(tag => tag.name);
        for (const tag of spec.tags) {
          if (!existingTagNames.includes(tag.name)) {
            mergedSpec.tags.push(tag);
          }
        }
      }
      
    } catch (error) {
      log.error(`  Failed to process ${specFile.file}: ${error.message}`);
    }
  }
  
  // Add module information to description
  if (moduleInfo.length > 0) {
    mergedSpec.info.description += `

## API Modules Included

| Module | Spec File | Endpoints |
|--------|-----------|-----------|
${moduleInfo.map(info => `| ${info.module} | ${info.file} | ${info.pathCount} |`).join('\n')}
    `;
  }
  
  return mergedSpec;
}

/**
 * Generate the HTML documentation using Swagger UI
 */
function generateHtmlDocumentation(mergedSpec) {
  // Write the merged spec to files
  const yamlPath = path.join(docsDir, 'openapi.yaml');
  const jsonPath = path.join(docsDir, 'openapi.json');
  
  fs.writeFileSync(yamlPath, yaml.dump(mergedSpec, { 
    lineWidth: -1, // Don't wrap lines
    noRefs: true,   // Don't use references
    indent: 2
  }));
  
  fs.writeFileSync(jsonPath, JSON.stringify(mergedSpec, null, 2));
  
  // Create the main HTML documentation page
  const htmlContent = createSwaggerUIHtml();
  fs.writeFileSync(path.join(docsDir, 'index.html'), htmlContent);
  
  // Create a simple landing page
  const landingContent = createLandingPage(mergedSpec);
  fs.writeFileSync(path.join(docsDir, 'landing.html'), landingContent);
  
  // Create a README
  const readmeContent = createReadme(mergedSpec);
  fs.writeFileSync(path.join(docsDir, 'README.md'), readmeContent);
  
  log.success(`Generated documentation files:`);
  log.success(`  - ${yamlPath}`);
  log.success(`  - ${jsonPath}`);
  log.success(`  - ${path.join(docsDir, 'index.html')}`);
  log.success(`  - ${path.join(docsDir, 'landing.html')}`);
  log.success(`  - ${path.join(docsDir, 'README.md')}`);
}

/**
 * Create Swagger UI HTML page
 */
function createSwaggerUIHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lean SaaS Starter API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui.css">
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.10.3/favicon-32x32.png" sizes="32x32">
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    
    .swagger-ui .topbar {
      background-color: #1f2937;
      border-bottom: 2px solid #3b82f6;
    }
    
    .swagger-ui .topbar .download-url-wrapper {
      display: none;
    }
    
    .swagger-ui .info .title {
      color: #1f2937;
    }
    
    .custom-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      text-align: center;
      margin-bottom: 0;
    }
    
    .custom-header h1 {
      margin: 0;
      font-size: 2.5rem;
      font-weight: 700;
    }
    
    .custom-header p {
      margin: 0.5rem 0 0 0;
      font-size: 1.2rem;
      opacity: 0.9;
    }
    
    .docs-links {
      background-color: #f8fafc;
      padding: 1rem;
      border-bottom: 1px solid #e2e8f0;
      text-align: center;
    }
    
    .docs-links a {
      display: inline-block;
      margin: 0 1rem;
      padding: 0.5rem 1rem;
      background-color: #3b82f6;
      color: white;
      text-decoration: none;
      border-radius: 0.375rem;
      font-weight: 500;
      transition: background-color 0.2s;
    }
    
    .docs-links a:hover {
      background-color: #2563eb;
    }
    
    #swagger-ui {
      max-width: 1200px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <h1>🚀 Lean SaaS Starter API</h1>
    <p>Complete API documentation for your SaaS application</p>
  </div>
  
  <div class="docs-links">
    <a href="openapi.yaml" target="_blank">📄 YAML Spec</a>
    <a href="openapi.json" target="_blank">📄 JSON Spec</a>
    <a href="landing.html">🏠 Documentation Home</a>
    <a href="README.md" target="_blank">📖 README</a>
  </div>
  
  <div id="swagger-ui"></div>
  
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "openapi.yaml",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        tryItOutEnabled: true,
        filter: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        validatorUrl: null,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        displayRequestDuration: true,
        showCommonExtensions: true,
        showExtensions: true
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Create a landing page
 */
function createLandingPage(spec) {
  const pathCount = Object.keys(spec.paths).length;
  const moduleCount = spec.tags?.length || 0;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lean SaaS Starter API Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 4rem 2rem;
      text-align: center;
      margin: -2rem -2rem 2rem -2rem;
    }
    
    .header h1 {
      font-size: 3rem;
      margin: 0;
      font-weight: 700;
    }
    
    .header p {
      font-size: 1.3rem;
      margin: 1rem 0 0 0;
      opacity: 0.9;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin: 2rem 0;
    }
    
    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    
    .stat-number {
      font-size: 2rem;
      font-weight: 700;
      color: #3b82f6;
    }
    
    .main-actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 2rem;
      margin: 3rem 0;
    }
    
    .action-card {
      background: white;
      padding: 2rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .action-card h3 {
      margin-top: 0;
      color: #1f2937;
    }
    
    .action-card a {
      display: inline-block;
      background: #3b82f6;
      color: white;
      padding: 0.75rem 1.5rem;
      text-decoration: none;
      border-radius: 0.375rem;
      font-weight: 500;
      transition: background-color 0.2s;
    }
    
    .action-card a:hover {
      background: #2563eb;
    }
    
    .modules {
      background: white;
      padding: 2rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      margin: 2rem 0;
    }
    
    .modules h2 {
      margin-top: 0;
    }
    
    .module-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
    
    .module-item {
      padding: 1rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.375rem;
    }
    
    .module-item h4 {
      margin: 0 0 0.5rem 0;
      color: #3b82f6;
    }
    
    .footer {
      text-align: center;
      margin: 3rem 0 1rem 0;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 API Documentation</h1>
      <p>Comprehensive documentation for the Lean SaaS Starter API</p>
    </div>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-number">${pathCount}</div>
        <div>API Endpoints</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${moduleCount}</div>
        <div>Modules</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">2</div>
        <div>Auth Methods</div>
      </div>
    </div>
    
    <div class="main-actions">
      <div class="action-card">
        <h3>📖 Interactive Documentation</h3>
        <p>Explore the API with our interactive Swagger UI documentation. Test endpoints directly from your browser.</p>
        <a href="index.html">Open Swagger UI</a>
      </div>
      
      <div class="action-card">
        <h3>📄 OpenAPI Specification</h3>
        <p>Download the complete OpenAPI specification in YAML or JSON format for integration with your tools.</p>
        <a href="openapi.yaml">Download YAML</a>
        <a href="openapi.json" style="margin-left: 1rem;">Download JSON</a>
      </div>
    </div>
    
    <div class="modules">
      <h2>API Modules</h2>
      <div class="module-list">
        ${spec.tags?.map(tag => `
          <div class="module-item">
            <h4>${tag.name}</h4>
            <p>${tag.description || 'No description available'}</p>
          </div>
        `).join('') || '<p>No modules found</p>'}
      </div>
    </div>
    
    <div class="footer">
      <p>Generated on ${new Date().toLocaleString()}</p>
      <p>API Version: ${spec.info.version}</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Create README.md for the documentation
 */
function createReadme(spec) {
  const pathCount = Object.keys(spec.paths).length;
  
  return `# Lean SaaS Starter API Documentation

This directory contains the complete API documentation for the Lean SaaS Starter.

## 📊 API Overview

- **Version**: ${spec.info.version}
- **Endpoints**: ${pathCount}
- **Modules**: ${spec.tags?.length || 0}
- **Generated**: ${new Date().toISOString()}

## 📁 Files

- **\`index.html\`** - Interactive Swagger UI documentation
- **\`landing.html\`** - Documentation landing page
- **\`openapi.yaml\`** - OpenAPI specification in YAML format
- **\`openapi.json\`** - OpenAPI specification in JSON format
- **\`README.md\`** - This file

## 🚀 Quick Start

1. **View Interactive Docs**: Open \`index.html\` in your browser
2. **Browse Overview**: Open \`landing.html\` for a quick overview
3. **Download Spec**: Use \`openapi.yaml\` or \`openapi.json\` for tooling

## 🛠️ Using the Specifications

### Code Generation

\`\`\`bash
# Generate TypeScript client
npx @openapitools/openapi-generator-cli generate \\
  -i docs/generated/openapi.yaml \\
  -g typescript-fetch \\
  -o ./src/api-client

# Generate Python client  
openapi-generator-cli generate \\
  -i docs/generated/openapi.yaml \\
  -g python \\
  -o ./api-client-python
\`\`\`

### Postman Collection

You can import the OpenAPI spec directly into Postman:

1. Open Postman
2. Click "Import"
3. Choose "Upload Files"
4. Select \`openapi.yaml\` or \`openapi.json\`

### Insomnia

Similarly for Insomnia:

1. Open Insomnia
2. Create New > Import from File
3. Select the OpenAPI spec file

## 🔐 Authentication

The API supports multiple authentication methods:

### Bearer Token (JWT)
\`\`\`bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  https://your-api.com/v1/endpoint
\`\`\`

### API Key
\`\`\`bash
curl -H "X-API-Key: YOUR_API_KEY" \\
  https://your-api.com/v1/endpoint
\`\`\`

## 📚 Modules

${spec.tags?.map(tag => `
### ${tag.name}

${tag.description || 'No description available'}
`).join('') || 'No modules documented'}

## 🔄 Regenerating Documentation

To regenerate this documentation:

\`\`\`bash
# From project root
pnpm docs:generate

# Or directly
node scripts/generate-api-docs.mjs
\`\`\`

## 📞 Support

For API support, please contact:
- **Email**: ${spec.info.contact?.email || 'support@example.com'}
- **GitHub**: ${spec.info.contact?.url || 'https://github.com/yourusername/lean-saas-starter'}

---

*Generated automatically from OpenAPI specifications*
`;
}

/**
 * Create a placeholder OpenAPI spec if none found
 */
function createPlaceholderSpec() {
  const baseSpec = createBaseSpec();
  
  // Add some example endpoints
  baseSpec.paths = {
    '/health': {
      get: {
        summary: 'Health check endpoint',
        description: 'Returns the health status of the API',
        tags: ['Core'],
        responses: {
          '200': {
            description: 'API is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                    version: { type: 'string', example: '1.0.0' }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
  
  baseSpec.info.description += `

**Note**: This is a placeholder specification. Add \`openapi.yaml\` files to your modules to see actual API documentation.

To add API documentation:

1. Create \`openapi.yaml\` files in your module directories
2. Run \`pnpm docs:generate\` to regenerate documentation
3. View the updated documentation in your browser
  `;
  
  return baseSpec;
}

/**
 * Main function to generate API documentation
 */
async function generateApiDocumentation() {
  try {
    log.header('API Documentation Generator');
    
    // Validate dependencies
    if (!await validateDependencies()) {
      process.exit(1);
    }
    
    // Ensure directories exist
    ensureDirectories();
    
    // Find all OpenAPI spec files
    const specFiles = findOpenApiSpecs();
    log.info(`Found ${specFiles.length} OpenAPI specification files`);
    
    let mergedSpec;
    
    if (specFiles.length === 0) {
      log.warning('No OpenAPI spec files found. Creating placeholder documentation.');
      mergedSpec = createPlaceholderSpec();
    } else {
      // Log found specs
      specFiles.forEach(spec => {
        log.info(`  - ${spec.module}/${spec.name}`);
      });
      
      // Merge all specifications
      mergedSpec = mergeOpenApiSpecs(specFiles);
    }
    
    // Generate HTML documentation
    generateHtmlDocumentation(mergedSpec);
    
    // Success summary
    log.header('Documentation Generation Complete');
    log.success(`📁 Documentation generated in: ${docsDir}`);
    log.success(`🌐 View documentation: file://${path.join(docsDir, 'index.html')}`);
    log.success(`📖 Or run: pnpm docs:serve`);
    
    const pathCount = Object.keys(mergedSpec.paths).length;
    const moduleCount = mergedSpec.tags?.length || 0;
    
    log.info(`📊 Documentation includes:`);
    log.info(`   - ${pathCount} API endpoints`);
    log.info(`   - ${moduleCount} modules`);
    log.info(`   - Interactive Swagger UI`);
    log.info(`   - Landing page`);
    log.info(`   - YAML and JSON specifications`);
    
  } catch (error) {
    log.error(`Documentation generation failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the generator if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateApiDocumentation();
}
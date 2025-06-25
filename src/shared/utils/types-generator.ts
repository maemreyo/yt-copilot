/**
 * Database Types Generation Utility
 * 
 * Generates TypeScript types from Supabase database schema.
 * Integrates with the build process and uses existing utilities.
 * 
 * Uses existing Layer 1 & 2 utilities:
 * - Database utilities from @/database
 * - Error handling from @/errors  
 * - Logging from @/logging
 * - Environment config from @/environment
 * - Migration utilities from @/migrations
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { database } from './database';
import { logger } from './logging';
import { migrationManager } from './migrations';
import { 
  ApiError, 
  ValidationError, 
  DatabaseError,
  ErrorCode 
} from './errors';
import { env, environment } from '../config/environment';

/**
 * Database schema information
 */
export interface SchemaInfo {
  tables: TableInfo[];
  views: ViewInfo[];
  functions: FunctionInfo[];
  enums: EnumInfo[];
  totalEntities: number;
  generatedAt: Date;
  schemaVersion: string;
}

/**
 * Table information interface
 */
export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  policies: PolicyInfo[];
  hasRLS: boolean;
}

/**
 * Column information interface
 */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isGenerated: boolean;
  comment?: string;
}

/**
 * Foreign key information
 */
export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete?: string;
  onUpdate?: string;
}

/**
 * Index information
 */
export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  partial?: string;
}

/**
 * RLS Policy information
 */
export interface PolicyInfo {
  name: string;
  command: string;
  roles: string[];
  using?: string;
  withCheck?: string;
}

/**
 * View information
 */
export interface ViewInfo {
  name: string;
  schema: string;
  definition: string;
  columns: ColumnInfo[];
}

/**
 * Function information
 */
export interface FunctionInfo {
  name: string;
  schema: string;
  returnType: string;
  parameters: ParameterInfo[];
  language: string;
  isSecurityDefiner: boolean;
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type: string;
  mode: 'IN' | 'OUT' | 'INOUT';
  defaultValue?: string;
}

/**
 * Enum information
 */
export interface EnumInfo {
  name: string;
  schema: string;
  values: string[];
}

/**
 * Type generation configuration
 */
export interface TypesGenerationConfig {
  outputPath: string;
  schemas: string[];
  includeViews: boolean;
  includeFunctions: boolean;
  includeEnums: boolean;
  generateComments: boolean;
  generateMetadata: boolean;
  validateAfterGeneration: boolean;
}

/**
 * Database schema introspector
 */
export class SchemaIntrospector {
  private client = database.getServiceClient();

  /**
   * Introspect complete database schema
   */
  async introspectSchema(schemas: string[] = ['public']): Promise<SchemaInfo> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting database schema introspection', { schemas });

      // Get all schema entities in parallel
      const [tables, views, functions, enums] = await Promise.all([
        this.getTables(schemas),
        this.getViews(schemas),
        this.getFunctions(schemas),
        this.getEnums(schemas)
      ]);

      const schemaInfo: SchemaInfo = {
        tables,
        views,
        functions,
        enums,
        totalEntities: tables.length + views.length + functions.length + enums.length,
        generatedAt: new Date(),
        schemaVersion: await this.getSchemaVersion()
      };

      const duration = Date.now() - startTime;
      logger.info('Schema introspection completed', {
        duration,
        tables: tables.length,
        views: views.length,
        functions: functions.length,
        enums: enums.length,
        totalEntities: schemaInfo.totalEntities
      });

      return schemaInfo;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Schema introspection failed', {
        duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new DatabaseError('Failed to introspect database schema', {
        context: { schemas, error }
      });
    }
  }

  /**
   * Get all tables in specified schemas
   */
  private async getTables(schemas: string[]): Promise<TableInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const tablesQuery = `
      SELECT 
        t.table_name,
        t.table_schema,
        obj_description(c.oid) as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      WHERE t.table_schema = ANY($1)
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: tablesQuery,
      params: [schemas]
    });

    if (result.error) {
      throw new DatabaseError('Failed to get tables information', {
        context: { error: result.error }
      });
    }

    const tables: TableInfo[] = [];

    for (const tableRow of result.data || []) {
      const tableInfo: TableInfo = {
        name: tableRow.table_name,
        schema: tableRow.table_schema,
        columns: await this.getTableColumns(tableRow.table_schema, tableRow.table_name),
        primaryKeys: await this.getPrimaryKeys(tableRow.table_schema, tableRow.table_name),
        foreignKeys: await this.getForeignKeys(tableRow.table_schema, tableRow.table_name),
        indexes: await this.getIndexes(tableRow.table_schema, tableRow.table_name),
        policies: await this.getPolicies(tableRow.table_schema, tableRow.table_name),
        hasRLS: await this.checkRLS(tableRow.table_schema, tableRow.table_name)
      };

      tables.push(tableInfo);
    }

    return tables;
  }

  /**
   * Get columns for a specific table
   */
  private async getTableColumns(schema: string, tableName: string): Promise<ColumnInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const columnsQuery = `
      SELECT 
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.is_generated,
        pgd.description as column_comment
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
      LEFT JOIN pg_attribute pga ON pga.attrelid = pgc.oid AND pga.attname = c.column_name
      LEFT JOIN pg_description pgd ON pgd.objoid = pgc.oid AND pgd.objsubid = pga.attnum
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: columnsQuery,
      params: [schema, tableName]
    });

    if (result.error) {
      throw new DatabaseError('Failed to get table columns', {
        context: { schema, tableName, error: result.error }
      });
    }

    return (result.data || []).map((col: any) => ({
      name: col.column_name,
      type: this.mapPostgreSQLTypeToTypeScript(col.data_type, col.udt_name),
      nullable: col.is_nullable === 'YES',
      defaultValue: col.column_default,
      isGenerated: col.is_generated === 'ALWAYS',
      comment: col.column_comment
    }));
  }

  /**
   * Get primary keys for a table
   */
  private async getPrimaryKeys(schema: string, tableName: string): Promise<string[]> {
    const helper = database.createQueryHelper(this.client);
    
    const pkQuery = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: pkQuery,
      params: [schema, tableName]
    });

    return (result.data || []).map((row: any) => row.column_name);
  }

  /**
   * Get foreign keys for a table
   */
  private async getForeignKeys(schema: string, tableName: string): Promise<ForeignKeyInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const fkQuery = `
      SELECT 
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu 
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc 
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: fkQuery,
      params: [schema, tableName]
    });

    return (result.data || []).map((row: any) => ({
      column: row.column_name,
      referencedTable: row.referenced_table,
      referencedColumn: row.referenced_column,
      onDelete: row.delete_rule,
      onUpdate: row.update_rule
    }));
  }

  /**
   * Get indexes for a table
   */
  private async getIndexes(schema: string, tableName: string): Promise<IndexInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const indexQuery = `
      SELECT 
        i.relname as index_name,
        array_agg(a.attname ORDER BY c.ordinality) as columns,
        ix.indisunique as is_unique,
        pg_get_expr(ix.indpred, ix.indrelid) as partial_condition
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN unnest(ix.indkey) WITH ORDINALITY c(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum
      WHERE n.nspname = $1 
        AND t.relname = $2
        AND NOT ix.indisprimary
      GROUP BY i.relname, ix.indisunique, ix.indpred
      ORDER BY i.relname
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: indexQuery,
      params: [schema, tableName]
    });

    return (result.data || []).map((row: any) => ({
      name: row.index_name,
      columns: row.columns,
      unique: row.is_unique,
      partial: row.partial_condition
    }));
  }

  /**
   * Get RLS policies for a table
   */
  private async getPolicies(schema: string, tableName: string): Promise<PolicyInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const policiesQuery = `
      SELECT 
        pol.polname as policy_name,
        pol.polcmd as command,
        array_agg(r.rolname) as roles,
        pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
        pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
      FROM pg_policy pol
      JOIN pg_class pc ON pol.polrelid = pc.oid
      JOIN pg_namespace pn ON pc.relnamespace = pn.oid
      LEFT JOIN pg_authid r ON r.oid = ANY(pol.polroles)
      WHERE pn.nspname = $1 AND pc.relname = $2
      GROUP BY pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck, pol.polrelid
      ORDER BY pol.polname
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: policiesQuery,
      params: [schema, tableName]
    });

    return (result.data || []).map((row: any) => ({
      name: row.policy_name,
      command: row.command,
      roles: row.roles || [],
      using: row.using_expression,
      withCheck: row.with_check_expression
    }));
  }

  /**
   * Check if table has RLS enabled
   */
  private async checkRLS(schema: string, tableName: string): Promise<boolean> {
    const helper = database.createQueryHelper(this.client);
    
    const rlsQuery = `
      SELECT pc.relrowsecurity
      FROM pg_class pc
      JOIN pg_namespace pn ON pc.relnamespace = pn.oid
      WHERE pn.nspname = $1 AND pc.relname = $2
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: rlsQuery,
      params: [schema, tableName]
    });

    return result.data?.[0]?.relrowsecurity || false;
  }

  /**
   * Get views information
   */
  private async getViews(schemas: string[]): Promise<ViewInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const viewsQuery = `
      SELECT 
        v.table_name as view_name,
        v.table_schema,
        v.view_definition
      FROM information_schema.views v
      WHERE v.table_schema = ANY($1)
      ORDER BY v.table_schema, v.table_name
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: viewsQuery,
      params: [schemas]
    });

    const views: ViewInfo[] = [];

    for (const viewRow of result.data || []) {
      const viewInfo: ViewInfo = {
        name: viewRow.view_name,
        schema: viewRow.table_schema,
        definition: viewRow.view_definition,
        columns: await this.getTableColumns(viewRow.table_schema, viewRow.view_name)
      };

      views.push(viewInfo);
    }

    return views;
  }

  /**
   * Get functions information
   */
  private async getFunctions(schemas: string[]): Promise<FunctionInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const functionsQuery = `
      SELECT 
        p.proname as function_name,
        n.nspname as schema_name,
        pg_get_function_result(p.oid) as return_type,
        p.prolang,
        l.lanname as language,
        p.prosecdef as is_security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = ANY($1)
        AND p.prokind = 'f'
      ORDER BY n.nspname, p.proname
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: functionsQuery,
      params: [schemas]
    });

    const functions: FunctionInfo[] = [];

    for (const funcRow of result.data || []) {
      const functionInfo: FunctionInfo = {
        name: funcRow.function_name,
        schema: funcRow.schema_name,
        returnType: this.mapPostgreSQLTypeToTypeScript(funcRow.return_type),
        parameters: await this.getFunctionParameters(funcRow.schema_name, funcRow.function_name),
        language: funcRow.language,
        isSecurityDefiner: funcRow.is_security_definer
      };

      functions.push(functionInfo);
    }

    return functions;
  }

  /**
   * Get function parameters
   */
  private async getFunctionParameters(schema: string, functionName: string): Promise<ParameterInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const paramsQuery = `
      SELECT 
        p.parameter_name,
        p.data_type,
        p.parameter_mode,
        p.parameter_default
      FROM information_schema.parameters p
      WHERE p.specific_schema = $1 
        AND p.specific_name LIKE $2 || '%'
      ORDER BY p.ordinal_position
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: paramsQuery,
      params: [schema, functionName]
    });

    return (result.data || []).map((param: any) => ({
      name: param.parameter_name,
      type: this.mapPostgreSQLTypeToTypeScript(param.data_type),
      mode: param.parameter_mode as 'IN' | 'OUT' | 'INOUT',
      defaultValue: param.parameter_default
    }));
  }

  /**
   * Get enums information
   */
  private async getEnums(schemas: string[]): Promise<EnumInfo[]> {
    const helper = database.createQueryHelper(this.client);
    
    const enumsQuery = `
      SELECT 
        t.typname as enum_name,
        n.nspname as schema_name,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE n.nspname = ANY($1)
        AND t.typtype = 'e'
      GROUP BY t.typname, n.nspname
      ORDER BY n.nspname, t.typname
    `;

    const result = await helper.rpc<any>('execute_sql', {
      sql: enumsQuery,
      params: [schemas]
    });

    return (result.data || []).map((enumRow: any) => ({
      name: enumRow.enum_name,
      schema: enumRow.schema_name,
      values: enumRow.enum_values
    }));
  }

  /**
   * Get schema version (based on migrations)
   */
  private async getSchemaVersion(): Promise<string> {
    try {
      // Use migration manager to get the latest applied migration
      const summary = await migrationManager.getMigrationSummary(
        path.join(process.cwd(), 'src', 'modules')
      );
      
      const totalApplied = summary.overall.applied;
      const timestamp = new Date().toISOString().split('T')[0];
      
      return `v${totalApplied}_${timestamp}`;
    } catch {
      return `v1_${new Date().toISOString().split('T')[0]}`;
    }
  }

  /**
   * Map PostgreSQL types to TypeScript types
   */
  private mapPostgreSQLTypeToTypeScript(pgType: string, udtName?: string): string {
    // Handle array types
    if (pgType.endsWith('[]')) {
      const baseType = this.mapPostgreSQLTypeToTypeScript(pgType.slice(0, -2));
      return `${baseType}[]`;
    }

    // Handle user-defined types and enums
    if (udtName && udtName !== pgType) {
      return this.pascalCase(udtName);
    }

    // Map common PostgreSQL types
    const typeMap: Record<string, string> = {
      // Numbers
      'integer': 'number',
      'bigint': 'number',
      'smallint': 'number',
      'decimal': 'number',
      'numeric': 'number',
      'real': 'number',
      'double precision': 'number',
      'serial': 'number',
      'bigserial': 'number',
      
      // Strings
      'text': 'string',
      'varchar': 'string',
      'character varying': 'string',
      'character': 'string',
      'char': 'string',
      
      // Booleans
      'boolean': 'boolean',
      'bool': 'boolean',
      
      // Dates
      'timestamp': 'string',
      'timestamptz': 'string',
      'timestamp with time zone': 'string',
      'timestamp without time zone': 'string',
      'date': 'string',
      'time': 'string',
      'timetz': 'string',
      'interval': 'string',
      
      // JSON
      'json': 'any',
      'jsonb': 'any',
      
      // UUID
      'uuid': 'string',
      
      // Network
      'inet': 'string',
      'cidr': 'string',
      'macaddr': 'string',
      
      // Arrays
      'ARRAY': 'any[]',
      
      // Others
      'bytea': 'string',
      'money': 'string'
    };

    return typeMap[pgType.toLowerCase()] || 'any';
  }

  /**
   * Convert string to PascalCase
   */
  private pascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]/g, '_')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

/**
 * TypeScript types generator
 */
export class TypesGenerator {
  /**
   * Generate TypeScript types from schema information
   */
  generateTypes(schema: SchemaInfo, config: TypesGenerationConfig): string {
    const parts: string[] = [];

    // Header comment
    parts.push(this.generateHeader(schema));

    // Generate enums
    if (config.includeEnums && schema.enums.length > 0) {
      parts.push(this.generateEnums(schema.enums));
    }

    // Generate table interfaces
    parts.push(this.generateTableInterfaces(schema.tables, config));

    // Generate view interfaces
    if (config.includeViews && schema.views.length > 0) {
      parts.push(this.generateViewInterfaces(schema.views, config));
    }

    // Generate function types
    if (config.includeFunctions && schema.functions.length > 0) {
      parts.push(this.generateFunctionTypes(schema.functions, config));
    }

    // Generate database interface
    parts.push(this.generateDatabaseInterface(schema));

    // Generate metadata
    if (config.generateMetadata) {
      parts.push(this.generateMetadata(schema));
    }

    return parts.join('\n\n');
  }

  /**
   * Generate file header
   */
  private generateHeader(schema: SchemaInfo): string {
    return `/**
 * Database Types
 * 
 * Auto-generated TypeScript types for Supabase database schema.
 * 
 * Generated: ${schema.generatedAt.toISOString()}
 * Schema Version: ${schema.schemaVersion}
 * Total Entities: ${schema.totalEntities}
 * 
 * Tables: ${schema.tables.length}
 * Views: ${schema.views.length}
 * Functions: ${schema.functions.length}
 * Enums: ${schema.enums.length}
 * 
 * ⚠️  DO NOT EDIT THIS FILE MANUALLY
 * This file is auto-generated. Run 'pnpm db:types:generate' to regenerate.
 */`;
  }

  /**
   * Generate enum types
   */
  private generateEnums(enums: EnumInfo[]): string {
    const enumTypes = enums.map(enumInfo => {
      const values = enumInfo.values.map(value => `  '${value}' = '${value}'`).join(',\n');
      
      return `export enum ${this.pascalCase(enumInfo.name)} {
${values}
}

export type ${this.pascalCase(enumInfo.name)}Type = \`\${${this.pascalCase(enumInfo.name)}}\`;`;
    });

    return `// Enums\n${enumTypes.join('\n\n')}`;
  }

  /**
   * Generate table interfaces
   */
  private generateTableInterfaces(tables: TableInfo[], config: TypesGenerationConfig): string {
    const interfaces = tables.map(table => {
      const tableName = this.pascalCase(table.name);
      
      // Generate table row interface
      const columns = table.columns.map(col => {
        const optional = col.nullable || col.defaultValue ? '?' : '';
        const comment = config.generateComments && col.comment ? 
          `  /** ${col.comment} */\n` : '';
        
        return `${comment}  ${col.name}${optional}: ${col.type}`;
      }).join('\n');

      // Generate insert interface (all optional except required fields)
      const insertColumns = table.columns
        .filter(col => !col.isGenerated)
        .map(col => {
          const required = !col.nullable && !col.defaultValue;
          const optional = required ? '' : '?';
          
          return `  ${col.name}${optional}: ${col.type}`;
        }).join('\n');

      // Generate update interface (all optional)
      const updateColumns = table.columns
        .filter(col => !col.isGenerated)
        .map(col => {
          return `  ${col.name}?: ${col.type}`;
        }).join('\n');

      return `// Table: ${table.name}
export interface ${tableName} {
${columns}
}

export interface ${tableName}Insert {
${insertColumns}
}

export interface ${tableName}Update {
${updateColumns}
}`;
    });

    return `// Tables\n${interfaces.join('\n\n')}`;
  }

  /**
   * Generate view interfaces
   */
  private generateViewInterfaces(views: ViewInfo[], config: TypesGenerationConfig): string {
    const interfaces = views.map(view => {
      const viewName = this.pascalCase(view.name);
      
      const columns = view.columns.map(col => {
        const optional = col.nullable ? '?' : '';
        const comment = config.generateComments && col.comment ? 
          `  /** ${col.comment} */\n` : '';
        
        return `${comment}  ${col.name}${optional}: ${col.type}`;
      }).join('\n');

      return `// View: ${view.name}
export interface ${viewName} {
${columns}
}`;
    });

    return `// Views\n${interfaces.join('\n\n')}`;
  }

  /**
   * Generate function types
   */
  private generateFunctionTypes(functions: FunctionInfo[], config: TypesGenerationConfig): string {
    const functionTypes = functions.map(func => {
      const funcName = this.pascalCase(func.name);
      
      const params = func.parameters
        .filter(p => p.mode === 'IN' || p.mode === 'INOUT')
        .map(p => {
          const optional = p.defaultValue ? '?' : '';
          return `  ${p.name}${optional}: ${p.type}`;
        }).join('\n');

      return `// Function: ${func.name}
export interface ${funcName}Params {
${params || '  // No parameters'}
}

export type ${funcName}Return = ${func.returnType};`;
    });

    return `// Functions\n${functionTypes.join('\n\n')}`;
  }

  /**
   * Generate main database interface
   */
  private generateDatabaseInterface(schema: SchemaInfo): string {
    const tableTypes = schema.tables.map(table => {
      const tableName = this.pascalCase(table.name);
      return `    ${table.name}: {
      Row: ${tableName}
      Insert: ${tableName}Insert
      Update: ${tableName}Update
    }`;
    }).join('\n');

    const viewTypes = schema.views.map(view => {
      const viewName = this.pascalCase(view.name);
      return `    ${view.name}: {
      Row: ${viewName}
    }`;
    }).join('\n');

    const functionTypes = schema.functions.map(func => {
      const funcName = this.pascalCase(func.name);
      return `    ${func.name}: {
      Args: ${funcName}Params
      Returns: ${funcName}Return
    }`;
    }).join('\n');

    return `// Database
export interface Database {
  public: {
    Tables: {
${tableTypes}
    }
    Views: {
${viewTypes}
    }
    Functions: {
${functionTypes}
    }
    Enums: {
${schema.enums.map(e => `      ${e.name}: ${this.pascalCase(e.name)}Type`).join('\n')}
    }
  }
}`;
  }

  /**
   * Generate metadata
   */
  private generateMetadata(schema: SchemaInfo): string {
    return `// Metadata
export const DatabaseMetadata = {
  schemaVersion: '${schema.schemaVersion}',
  generatedAt: '${schema.generatedAt.toISOString()}',
  totalEntities: ${schema.totalEntities},
  tables: ${schema.tables.length},
  views: ${schema.views.length},
  functions: ${schema.functions.length},
  enums: ${schema.enums.length}
} as const;`;
  }

  private pascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]/g, '_')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

/**
 * Main types generation manager
 */
export class TypesGenerationManager {
  private introspector = new SchemaIntrospector();
  private generator = new TypesGenerator();

  /**
   * Generate types and write to file
   */
  async generateAndWrite(config: TypesGenerationConfig): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting database types generation', {
        outputPath: config.outputPath,
        schemas: config.schemas
      });

      // Ensure output directory exists
      const outputDir = path.dirname(config.outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        logger.debug('Created output directory', { outputDir });
      }

      // Introspect database schema
      const schema = await this.introspector.introspectSchema(config.schemas);

      // Generate TypeScript types
      const typesContent = this.generator.generateTypes(schema, config);

      // Write to file
      fs.writeFileSync(config.outputPath, typesContent, 'utf-8');

      // Validate if requested
      if (config.validateAfterGeneration) {
        await this.validateGeneratedTypes(config.outputPath);
      }

      const duration = Date.now() - startTime;
      logger.info('Database types generation completed', {
        outputPath: config.outputPath,
        schemaVersion: schema.schemaVersion,
        totalEntities: schema.totalEntities,
        duration
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Database types generation failed', {
        duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new ValidationError('Failed to generate database types', {
        context: { config, error }
      });
    }
  }

  /**
   * Validate generated types by attempting to compile them
   */
  private async validateGeneratedTypes(filePath: string): Promise<void> {
    try {
      // Use TypeScript compiler to validate
      execSync(`npx tsc --noEmit --skipLibCheck ${filePath}`, {
        stdio: 'pipe',
        cwd: process.cwd()
      });

      logger.debug('Generated types validation passed', { filePath });

    } catch (error) {
      logger.warn('Generated types validation failed', {
        filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Don't throw, just warn as the types might still be usable
    }
  }

  /**
   * Get default configuration
   */
  getDefaultConfig(): TypesGenerationConfig {
    return {
      outputPath: path.join(process.cwd(), 'packages', 'db-types', 'index.ts'),
      schemas: ['public'],
      includeViews: true,
      includeFunctions: true,
      includeEnums: true,
      generateComments: true,
      generateMetadata: true,
      validateAfterGeneration: environment.isDevelopment()
    };
  }
}

// Export singleton instance
export const typesGenerator = new TypesGenerationManager();

// Export utilities
export const typesUtils = {
  introspector: SchemaIntrospector,
  generator: TypesGenerator,
  manager: typesGenerator,
};
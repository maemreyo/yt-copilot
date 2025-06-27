/**
 * Simplified DatabaseService for Deno environment
 * This is a lightweight version of the main DatabaseService
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '@/logging';

export class DatabaseService {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    this.logger = new Logger({
      service: 'database-service',
      level: 'info',
      enablePerformanceTracking: true,
    });
  }

  /**
   * Get a record by ID
   */
  async getById(table: string, id: string, select = '*') {
    try {
      const { data, error } = await this.supabase
        .from(table)
        .select(select)
        .eq('id', id)
        .single();

      if (error) {
        this.logger.error(`Failed to get ${table} by ID`, {
          table,
          id,
          error: error.message,
        });
        throw error;
      }

      return data;
    } catch (error: any) {
      this.logger.error(`Error in getById for ${table}`, {
        table,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Query records with filters
   */
  async query(table: string, filters: Record<string, any>, select = '*') {
    try {
      let query = this.supabase.from(table).select(select);

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value)) {
          query = query.in(key, value);
        } else {
          query = query.eq(key, value);
        }
      }

      const { data, error } = await query;

      if (error) {
        this.logger.error(`Failed to query ${table}`, {
          table,
          filters,
          error: error.message,
        });
        throw error;
      }

      return data;
    } catch (error: any) {
      this.logger.error(`Error in query for ${table}`, {
        table,
        filters,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Insert a record
   */
  async insert(table: string, data: Record<string, any>, select = '*') {
    try {
      const { data: result, error } = await this.supabase
        .from(table)
        .insert(data)
        .select(select);

      if (error) {
        this.logger.error(`Failed to insert into ${table}`, {
          table,
          error: error.message,
        });
        throw error;
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Error in insert for ${table}`, {
        table,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update a record
   */
  async update(
    table: string,
    id: string,
    data: Record<string, any>,
    select = '*',
  ) {
    try {
      const { data: result, error } = await this.supabase
        .from(table)
        .update(data)
        .eq('id', id)
        .select(select);

      if (error) {
        this.logger.error(`Failed to update ${table}`, {
          table,
          id,
          error: error.message,
        });
        throw error;
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Error in update for ${table}`, {
        table,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete a record
   */
  async delete(table: string, id: string) {
    try {
      const { error } = await this.supabase
        .from(table)
        .delete()
        .eq('id', id);

      if (error) {
        this.logger.error(`Failed to delete from ${table}`, {
          table,
          id,
          error: error.message,
        });
        throw error;
      }

      return true;
    } catch (error: any) {
      this.logger.error(`Error in delete for ${table}`, {
        table,
        id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get the Supabase client directly
   */
  getClient() {
    return this.supabase;
  }
}

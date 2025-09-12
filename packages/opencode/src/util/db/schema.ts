import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Define the symbols table schema
export const symbolsTable = sqliteTable("symbols", {
  name: text("name").notNull(),
  symbol_fqn: text("symbol_fqn").primaryKey(),
  module_fqn: text("module_fqn").notNull(),
  type: text("type", { enum: ["module", "class", "function", "method"] }).notNull(),
  visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
  isAsync: integer("is_async", { mode: "boolean" }).notNull(),
  docstring: text("docstring"),
  docstring_summary: text("docstring_summary"),
  location_path: text("location_path").notNull(),
  location_line_start: integer("location_line_start").notNull(),
  location_line_end: integer("location_line_end").notNull(),
  signature_parameters: text("signature_parameters", { mode: "json" }),
  signature_returnType: text("signature_returnType"),
  signature_decorators: text("signature_decorators", { mode: "json" }),
});

// Define the relationships table schema
export const relationshipsTable = sqliteTable("relationships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["import", "call", "inherit", "override"] }).notNull(),
  source: text("source").notNull(),
  target: text("target").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.source, table.target, table.type] }),
}));
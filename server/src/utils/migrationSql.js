async function executeSegment(connection, segment, delimiter) {
  if (!segment.trim()) return;
  if (delimiter === ';') {
    await connection.query(segment);
    return;
  }
  for (const statement of segment.split(delimiter)) {
    if (statement.trim()) await connection.query(statement);
  }
}

export async function executeMigrationSql(connection, sql) {
  const directive = /^\s*DELIMITER\s+(\S+)\s*$/gim;
  let delimiter = ';';
  let cursor = 0;
  let match;
  while ((match = directive.exec(sql)) !== null) {
    await executeSegment(connection, sql.slice(cursor, match.index), delimiter);
    delimiter = match[1];
    cursor = directive.lastIndex;
  }
  await executeSegment(connection, sql.slice(cursor), delimiter);
}

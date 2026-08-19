import { pool } from '../src/db/pool.js';
import { scanParticipationRestrictions } from '../src/services/participationEligibilityService.js';

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const result = await scanParticipationRestrictions(connection, { triggerSource: 'scheduled_scan' });
  await connection.commit();
  console.log(JSON.stringify(result));
} catch (error) {
  await connection.rollback().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}

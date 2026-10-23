import { execFileSync } from 'node:child_process';

const mysqlContainer = process.env.PLM_E2E_MYSQL_CONTAINER || 'mysql';
const mysqlDatabase = process.env.PLM_E2E_MYSQL_DATABASE || 'a_lab01_3f9ebc219';
const mysqlUser = process.env.PLM_E2E_MYSQL_USER || 'root';
const mysqlPassword =
  process.env.PLM_E2E_MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || 'Mysql@2022';

const query = `SELECT
  p.UID AS username,
  p.DISPLAY_NAME AS displayName,
  p.STATUS AS status,
  p.ENABLED AS enabled,
  IFNULL(GROUP_CONCAT(r.NAME ORDER BY r.NAME SEPARATOR '|'), '') AS roles
FROM ${mysqlDatabase}.sys_person p
LEFT JOIN ${mysqlDatabase}.sys_role_member rm ON rm.MEMBER_UID = p.UID
LEFT JOIN ${mysqlDatabase}.sys_role r ON r.ID = rm.ROLE_ID
GROUP BY p.UID, p.DISPLAY_NAME, p.STATUS, p.ENABLED
ORDER BY p.UID`;

const stdout = execFileSync(
  'docker',
  [
    'exec',
    mysqlContainer,
    'mysql',
    `-h127.0.0.1`,
    `-u${mysqlUser}`,
    `-p${mysqlPassword}`,
    '--batch',
    '--raw',
    '-e',
    query,
  ],
  { encoding: 'utf8' },
);

const lines = stdout.trim().split('\n');
if (lines.length < 2) {
  throw new Error('No local PLM accounts were found');
}

const headers = lines[0].split('\t');
const accounts = lines.slice(1).map(line => {
  const row = Object.fromEntries(line.split('\t').map((value, index) => [headers[index], value]));
  return {
    username: row.username,
    displayName: row.displayName,
    status: row.status,
    enabled: row.enabled,
    roles: row.roles ? row.roles.split('|') : [],
  };
});

console.log(JSON.stringify(accounts, null, process.stdout.isTTY ? 2 : 0));

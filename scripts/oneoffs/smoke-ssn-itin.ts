import '../../server/storage/database';
import { ssnValidate } from '../../server/storage/workers';

async function main() {
  // ITIN-style, strict (default): should fail
  const strict = await ssnValidate.validate({ ssn: '912-34-5678' });
  console.log('strict 9xx:', strict.ok ? 'OK (BAD)' : `rejected: ${(strict as any).errors[0].message}`);
  // ITIN-style with opt-out: should pass
  const relaxed = await ssnValidate.validate({ ssn: '912-34-5678', allowSsaRuleInvalid: true });
  console.log('relaxed 9xx:', relaxed.ok ? `accepted ssn=${(relaxed as any).value.ssn}` : 'rejected (BAD)');
  // Malformed with opt-out: should still fail
  const malformed = await ssnValidate.validate({ ssn: '12-3456-78901', allowSsaRuleInvalid: true });
  console.log('relaxed malformed:', malformed.ok ? 'OK (BAD)' : `rejected: ${(malformed as any).errors[0].message}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

/** Deterministic model decisions; production template and all DSH/MCP tools stay real. */
const requirements = `# 购物车需求\nAC-01: 合法单价（分）与数量计算总价。\nAC-02: 0..100 整数折扣按总价折扣后向下取整。\nAC-03: 空购物车为零。\nAC-04: 非法单价、数量、折扣抛 TypeError。\n非目标：持久化、UI、付款。\n`;
const design = `# 购物车设计\n新增 src/cart.cjs 导出 calculateTotal(items, discountPercent=0)。\nAC-01/02：安全整数校验后汇总，折扣用 Math.floor。\nAC-03：空数组返回零。AC-04：非数组、非法字段、溢出均抛 TypeError。\n测试：test/cart.test.cjs，使用 node:test，不新增依赖。\n`;
const implementation = `function calculateTotal(items, discountPercent = 0) {
  if (!Array.isArray(items) || !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new TypeError('Invalid input');
  let total = 0;
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.priceCents) || item.priceCents < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new TypeError('Invalid item');
    const value = item.priceCents * item.quantity;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) throw new TypeError('Overflow');
    total += value;
  }
  return Number(BigInt(total) * BigInt(100 - discountPercent) / 100n);
}
module.exports = { calculateTotal };
`;
const tests = `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateTotal } = require('../src/cart.cjs');
test('AC-01 sums cents and quantities', () => assert.equal(calculateTotal([{priceCents:1999,quantity:2},{priceCents:500,quantity:1}]),4498));
test('AC-02 discounts and rounds down', () => {assert.equal(calculateTotal([{priceCents:1999,quantity:2},{priceCents:500,quantity:1}],10),4048);assert.equal(calculateTotal([{priceCents:100,quantity:1}],93),7)});
test('AC-02 full discount', () => assert.equal(calculateTotal([{priceCents:100,quantity:1}],100),0));
test('AC-03 empty cart', () => assert.equal(calculateTotal([]),0));
test('AC-04 rejects invalid items', () => {for(const item of [{priceCents:-1,quantity:1},{priceCents:1.5,quantity:1},{priceCents:1,quantity:0},null]) assert.throws(()=>calculateTotal([item]),TypeError)});
test('AC-04 rejects invalid discount and cart', () => {for(const p of [-1,101,1.5,NaN])assert.throws(()=>calculateTotal([],p),TypeError);assert.throws(()=>calculateTotal(null),TypeError)});
test('AC-04 rejects overflow', () => assert.throws(()=>calculateTotal([{priceCents:Number.MAX_SAFE_INTEGER,quantity:2}]),TypeError));
`;
const op = (name,args,expect) => ({name,args,...(expect?{expect}:{})});
const read = (path,expect) => op('mcp__delivery_repo__read_document',{path},expect);
const write = (file_path,content) => op('write',{file_path,content});
const validate = op('bash',{description:'Run shopping cart acceptance tests',command:'node --test test/cart.test.cjs && node -e \'console.log("STARTER_TESTS_PASSED")\'',timeoutMs:20000},'STARTER_TESTS_PASSED');
const stage = (id,expect,operations) => [op('skill',{name:'delivery-'+id},'主要报告'),op('mcp__delivery_repo__workspace_summary',{},expect),...operations];
export const starterOperations = {
  requirements:stage('requirements','README.md',[write('.delivery/outputs/requirements.md',requirements)]),
  design:stage('design','requirements.md',[read('.delivery/outputs/requirements.md','AC-01'),write('.delivery/outputs/design.md',design)]),
  implement:stage('implement','design.md',[read('.delivery/outputs/design.md','src/cart.cjs'),write('src/cart.cjs',implementation),write('test/cart.test.cjs',tests),validate,write('.delivery/outputs/implementation.md','# 实现报告\nAC-01..04 已实现。node --test test/cart.test.cjs：7 项通过，退出码 0。\n')]),
  verify:stage('verify','implementation.md',[read('.delivery/outputs/requirements.md','AC-04'),read('.delivery/outputs/implementation.md','7 项通过'),validate,write('.delivery/outputs/test-report.md','# 独立测试报告\nAC-01..04 覆盖正常、折扣、空输入、非法输入及溢出。\nnode --test test/cart.test.cjs：7 项通过，0 失败，退出码 0。\n无未处理缺陷。\n')]),
};

export const starterStageNames = {'需求分析':'requirements','方案设计':'design','编码实现':'implement','测试验证':'verify'};

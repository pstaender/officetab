import { describe, expect, it } from 'vitest';
import { ScFunctionMgr, ScFunctionList } from '../../src/lo/sc/source/core/data/funcdesc.ts';
import { ocSum, ocIf, ocVLookup } from '../../src/lo/include/formula/opcode.ts';
import { ID_FUNCTION_GRP_TABLE } from '../../src/lo/sc/inc/scfuncs.ts';

describe('ScFuncDesc', () => {
  const mgr = ScFunctionMgr.Get();
  it('builds SUM signature as upstream', () => {
    const d = mgr.GetByName('sum')!;
    expect(d.nFIndex).toBe(ocSum);
    expect(d.getSignature()).toBe('SUM( Number 1, Number 2, ... \u00A0)');
    expect(d.getDescription()).toBe('Returns the sum of all arguments.');
  });
  it('categorises VLOOKUP', () => {
    const d = mgr.GetByOpCode(ocVLookup)!;
    expect(d.nCategory).toBe(ID_FUNCTION_GRP_TABLE);
    expect(d.getCategory()!.getName()).toBe('Spreadsheet');
    expect(d.isParameterOptional(3)).toBe(true);
    expect(d.isParameterOptional(0)).toBe(false);
  });
  it('describes the parameters of IF', () => {
    const d = mgr.GetByName('IF')!;
    expect(d.getParameterCount()).toBe(3);
    expect([0, 1, 2].map((i) => d.getParameterName(i))).toEqual(['Test', 'Then value', 'Otherwise value']);
    expect(d.getParameterDescription(0)).toBe('Any value or expression which can be either TRUE or FALSE.');
    expect(d.getSignature()).toBe('IF( Test, Then value, Otherwise value\u00A0)');
  });
  it('knows what is implemented', () => {
    expect(mgr.GetByOpCode(ocSum)!.IsImplemented()).toBe(true);
    expect(mgr.GetByOpCode(ocIf)!.IsImplemented()).toBe(true);
    expect(mgr.GetFunctions().some((d) => !d.IsImplemented())).toBe(true);
    const impl = ScFunctionMgr.Get(true);
    expect(impl.GetFunctions().every((d) => d.IsImplemented())).toBe(true);
    expect(impl.GetFunctions().length).toBeLessThan(mgr.GetFunctions().length);
  });
  it('lists about as many functions as upstream, sorted by name', () => {
    const n = new ScFunctionList().GetCount();
    expect(n).toBeGreaterThan(400);
    const names = mgr.GetFunctions().map((d) => d.getFunctionName());
    expect(names.indexOf('ABS')).toBeLessThan(names.indexOf('SUM'));
    expect(mgr.getCount()).toBe(11);
    expect(ScFunctionMgr.GetCategoryName(0)).toBe('Database');
  });
});

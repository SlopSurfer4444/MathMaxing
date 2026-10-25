import test from 'node:test';
import assert from 'node:assert/strict';
import { families } from './numeric-families.mjs';
import { createInstance, checkPart, publicLesson } from './registry.mjs';
import { checkNumericAnswer } from '../percentages.mjs';

const seeds = [...Array.from({ length: 31 }, (_, i) => i), 99, 2147483647];
const get = (id) => families.find(f => f.id === id);
const nums = (text) => (text.match(/[−-]?\d+(?:,\d+)?/g) ?? []).map(v => Number(v.replace('−', '-').replace(',', '.')));
const ratio = (a, b) => `${a}/${b}`;
const verify = (instance, values) => {
  const parts=instance.parts.filter(p=>p.check==='numeric');
  assert.equal(values.length, parts.length, instance.id);
  values.forEach((value, i) => assert.equal(checkNumericAnswer(String(value), parts[i].expected).status, 'correct', `${instance.id}/${parts[i].id}: expected ${parts[i].expected}, independently calculated ${value}`));
};

test('numeric packs provide bounded, frozen, authored lessons and distinct task structures', () => {
  assert.equal(families.length, 16);
  const ids = new Set(families.map(f => f.id));
  assert.equal(ids.size, families.length);
  for (const family of families) {
    assert.ok(family.scope && family.exclusions.length && family.skills.length, family.id);
    assert.ok(family.templates.length >= 2, family.id);
    assert.ok(Number.isInteger(family.version) && family.version >= 1);
    assert.equal(new Set(family.templates.map(t => t.id)).size, family.templates.length);
    for (const field of ['meaning', 'notation', 'conditions', 'why']) assert.ok(family.lesson[field], `${family.id}/${field}`);
    assert.ok(family.lesson.example.prompt && family.lesson.example.solution);
    assert.ok(family.lesson.probe.prompt && family.lesson.probe.explanation);
    assert.ok(family.lesson.pitfalls.length);
    assert.ok(family.lesson.links.length);
    for (const link of family.lesson.links) assert.ok(ids.has(link), `${family.id}: unknown learning link ${link}`);
    for (const pre of family.prerequisites) { assert.ok(ids.has(pre.familyId)); assert.ok(['hard', 'method', 'helpful'].includes(pre.role)); }
    const prompts = new Set();
    for (const template of family.templates) {
      prompts.add(template.build(0).prompt);
      for (const seed of seeds) {
        const item = template.build(seed);
        assert.deepEqual(item, template.build(seed));
        assert.equal(item.familyId, family.id);
        assert.equal(item.version, family.version);
        assert.equal(item.id, `${family.id}:v${family.version}:${template.id}:${seed}`);
        assert.equal(item.templateId, template.id);
        assert.equal(item.seed, seed);
        assert.ok(Object.isFrozen(item) && Object.isFrozen(item.parts) && Object.isFrozen(item.reference));
        assert.ok(item.prompt.length > 20);
        for (const part of item.parts) {
          assert.ok(Object.isFrozen(part));
          assert.ok(item.reference.some(r => r.partId === part.id && r.text));
          if(part.check==='numeric'){
            assert.equal(part.kind, 'number');
            assert.equal(checkNumericAnswer(String(part.expected), String(part.expected)).status, 'correct');
          }else{assert.equal(part.check,'proof');assert.equal(part.kind,'text');assert.ok(part.scope.includes('unknown'));}
        }
      }
      for (const invalid of [-1, 2147483648, NaN, Infinity, 1.5, '0', null, undefined]) assert.throws(() => template.build(invalid), RangeError);
    }
    assert.equal(prompts.size, family.templates.length, `${family.id}: identical structures`);
  }
});

test('percentages, units and text models match independently reconstructed quantities', () => {
  for (const id of ['number.percent', 'model.formula-units', 'model.text']) for (const t of get(id).templates) for (const s of seeds) {
    const item = t.build(s), a = nums(item.prompt);
    switch (t.id) {
      case 'discount': verify(item, [a[0] * (100-a[1])/100]); break;
      case 'reverse': verify(item, [ratio(a[1]*100,100-a[0])]); break;
      case 'successive': { // Compare two actual prices on a base of 10,000.
        const afterRise = 10000 + a[0]*100;
        const afterFall = afterRise*(100-a[1])/100;
        verify(item, [(10000-afterFall)/100]); break;
      }
      case 'speed': verify(item, [ratio(a[0]*a[1]*5,18)]); break;
      case 'threshold': { let hours=0; while (a[0]+a[1]*(hours+1)<=a[2]) hours++; verify(item,[hours]); break; }
      case 'meeting': verify(item,[ratio(a[2],a[0]+a[1])]); break;
      case 'joint-work': verify(item,[ratio(a[0]*a[1],a[0]+a[1])]); break;
      case 'mixture': verify(item,[ratio(a[0]*a[1]+a[2]*a[3],a[0]+a[2])]); break;
      default: assert.fail(t.id);
    }
  }
});

test('finance independently simulates period bases and contribution timing using rational units', () => {
  for (const id of ['finance.debt','finance.savings']) for (const t of get(id).templates) for (const seed of seeds) {
    const item=t.build(seed), a=nums(item.prompt);
    if (t.id==='equal-principal') {
      const [principal,periods,rate,repayment]=a;
      let outstanding=principal,total=0;
      for(let year=0;year<periods;year++) { total+=outstanding*rate/100+repayment; outstanding-=repayment; }
      assert.equal(outstanding,0); verify(item,[total]);
      // A flat percentage on the initial debt every year must differ.
      assert.notEqual(total,principal+periods*principal*rate/100);
    } else if (t.id==='two-equal-payments') {
      const [principal,rate]=a;
      const paymentNumerator=principal*(100+rate)**2;
      const paymentDenominator=100*(200+rate);
      verify(item,[ratio(paymentNumerator,paymentDenominator)]);
      // Independent ledger in integer denominator units closes at zero.
      const p=Number(item.parts[0].expected);
      const d1=principal*(100+rate)-p*100;
      assert.equal(d1*(100+rate)-p*10000,0);
    } else if (t.id==='compound') {
      const [initial,rate,periods]=a;
      let numerator=initial, denominator=1;
      for(let i=0;i<periods;i++) { numerator*=100+rate; denominator*=100; }
      verify(item,[ratio(numerator,denominator)]);
    } else {
      const [deposit,rate]=a;
      // Scale to millionths of a rouble. Three periods divide exactly.
      let amount=0;
      for(let i=0;i<3;i++) amount=(amount+deposit*1000000)*(100+rate)/100;
      verify(item,[ratio(amount,1000000)]);
      let endDeposit=0;
      for(let i=0;i<3;i++) endDeposit=endDeposit*(100+rate)/100+deposit;
      assert.notEqual(Number(item.parts[0].expected),endDeposit);
    }
  }
});

test('finite probabilities use enumeration rather than the generator formulas', () => {
  for (const id of ['probability.finite','probability.conditional','probability.combinatorics']) for (const t of get(id).templates) for(const seed of seeds) {
    const item=t.build(seed),a=nums(item.prompt);
    if(t.id==='complement') {
      const balls=[...Array(a[0]).fill('white'),...Array(a[1]).fill('black')];
      verify(item,[ratio(balls.filter(v=>v!=='white').length,balls.length)]);
    } else if(t.id==='dice-sum') {
      const target=a.at(-1); let hit=0,total=0;
      for(let first=1;first<=6;first++)for(let second=1;second<=6;second++){total++;if(first+second===target)hit++;}
      verify(item,[ratio(hit,total)]);
    } else if(t.id==='without-replacement') {
      const balls=[...Array(a[0]).fill(1),...Array(a[1]).fill(0)];let hit=0,total=0;
      for(let i=0;i<balls.length;i++)for(let j=0;j<balls.length;j++)if(i!==j){total++;hit+=balls[i]*balls[j];}
      verify(item,[ratio(hit,total)]);
    } else if(t.id==='total-probability') {
      // A cohort of 10,000: 100*w in first source, rest in second.
      const [w,p,q]=a;
      const markedFirst=w*p,markedSecond=(100-w)*q;
      verify(item,[ratio(markedFirst+markedSecond,10000)]);
    } else if(t.id==='unordered-pair') {
      let count=0;for(let i=0;i<a[0];i++)for(let j=i+1;j<a[0];j++)count++;
      verify(item,[count]);
    } else if(t.id==='ordered-roles') {
      let count=0;for(let i=0;i<a[0];i++)for(let j=0;j<a[0];j++)for(let k=0;k<a[0];k++)if(i!==j&&j!==k&&i!==k)count++;
      verify(item,[count]);
    } else assert.fail(t.id);
  }
});

test('statistics and progressions are verified by expanded observations and repeated operations',()=>{
  for(const id of ['data.statistics','sequence.progressions'])for(const t of get(id).templates)for(const seed of seeds){
    const item=t.build(seed),a=nums(item.prompt);
    if(t.id==='frequency-mean'){
      const values=item.table.rows.flatMap(([value,count])=>Array(count).fill(value));
      verify(item,[ratio(values.reduce((x,y)=>x+y,0),values.length)]);
    }else if(t.id==='median-range'){
      a.sort((x,y)=>x-y);verify(item,[a[(a.length-1)/2],a.at(-1)-a[0]]);
    }else if(t.id==='arithmetic-sum'){
      let value=a[0],total=0;for(let i=0;i<a[2];i++){total+=value;value+=a[1];}verify(item,[total]);
    }else{
      let value=a[0],total=0;for(let i=0;i<a[2];i++){total+=value;value*=a[1];}verify(item,[total]);
    }
  }
});

test('discrete expectation and variance use direct weighted deviations',()=>{
  for(const t of get('probability.discrete').templates)for(const seed of seeds){
    const item=t.build(seed);let rows;
    if(item.table) rows=item.table.rows.map(([x,p])=>[x,Number(p.replace(',','.'))]);
    else{const a=nums(item.prompt);rows=[[a[0],a[1]],[0,1-a[1]]];}
    assert.equal(rows.reduce((sum,[,p])=>sum+p,0),1);
    const mean=rows.reduce((sum,[x,p])=>sum+x*p,0);
    const variance=rows.reduce((sum,[x,p])=>sum+(x-mean)**2*p,0);
    verify(item,[mean,variance]);
  }
});

test('constrained modelling maxima agree with exhaustive feasible choices, including ties and binding bounds',()=>{
  const family=get('model.optimization');
  assert.deepEqual(family.alignments,{'2026':[],'2027':[17]});
  let binding=0,nonbinding=0;
  for(const t of family.templates)for(const seed of seeds){
    const item=t.build(seed),a=nums(item.prompt);let candidates;
    if(t.id==='integer-revenue'){
      const [price,demand,step,,bound]=a;assert.equal(bound,demand);
      candidates=Array.from({length:demand+1},(_,n)=>({x:n,value:(price+n*step)*(demand-n)}));
    }else{
      const [perimeter,cap]=a;
      candidates=Array.from({length:cap},(_,i)=>({x:i+1,value:(i+1)*(perimeter/2-i-1)})).filter(c=>perimeter/2-c.x>0);
      if(cap<perimeter/4)binding++;else nonbinding++;
    }
    const max=Math.max(...candidates.map(c=>c.value));
    const optima=candidates.filter(c=>c.value===max);
    verify(item,[Math.min(...optima.map(c=>c.x)),max]);
    if(t.id==='integer-revenue')assert.equal(optima.length,2,'discrete tie must be resolved by smallest n');
    assert.equal(item.parts.at(-1).check,'proof');
    assert.ok(item.reference.find(r=>r.partId==='c').text.includes('границ'));
  }
  assert.ok(binding>0&&nonbinding>0,'area constraints must cover both binding and nonbinding boundary');
});

test('continuous distributions keep model, CDF endpoint semantics and supplied precision distinct',()=>{
  for(const id of ['distribution.uniform','distribution.exponential','distribution.normal','distribution.cdf']){
    const family=get(id);assert.deepEqual(family.alignments['2026'],[]);assert.deepEqual(family.alignments['2027'],[6]);
    assert.match(family.scope,/./);assert.ok(family.exclusions.some(v=>v.includes('проект')));
    for(const t of family.templates)for(const seed of seeds){
      const item=t.build(seed), a=nums(item.prompt);
      if(t.id==='clipped-interval'){
        const [left,right,low,high]=a;
        verify(item,[ratio(Math.max(0,Math.min(right,high)-Math.max(left,low)),right-left)]);
      }else if(t.id==='unknown-endpoint'){
        const [left,threshold,,p]=a;verify(item,[left+(threshold-left)/p]);
      }else if(t.id==='half-life-cdf'){
        const [,halfLife,time]=a;let survival=1;for(let t=0;t<time;t+=halfLife)survival/=2;
        verify(item,[1-survival]);
      }else if(t.id==='memoryless'){
        const [,halfLife,already,,end,condition]=a;
        assert.equal(already,condition);
        // Compute joint and conditioning events separately before division.
        verify(item,[2**(-end/halfLife)/2**(-condition/halfLife)]);
      }else if(t.id==='central-interval'){
        const [mu,sigma,z,phi,low,high]=a;
        assert.equal((high-mu)/sigma,z);assert.equal((low-mu)/sigma,-z);
        const leftTail=1-phi;verify(item,[(Math.round((phi-leftTail)*10000))/10000]);
      }else if(t.id==='upper-tail'){
        const [mu,variance,z,phi,threshold]=a;
        assert.equal((threshold-mu)/Math.sqrt(variance),z);verify(item,[Math.round((1-phi)*10000)/10000]);
      }else if(t.id==='linear-cdf'){
        const m=/F\(x\)=\(x−(\d+)\)\/(\d+)/.exec(item.prompt);assert.ok(m);
        const left=Number(m[1]),width=Number(m[2]);
        const [low,high]=nums(item.prompt.slice(item.prompt.indexOf('Найдите')));
        const F=x=>Math.max(0,Math.min(1,(x-left)/width));verify(item,[F(high)-F(low)]);
      }else if(t.id==='jump-cdf'){
        const values=[...item.prompt.matchAll(/F\(x\)=(\d+(?:,\d+)?)/g)].map(m=>Number(m[1].replace(',','.')));
        assert.equal(values.length,4);const [,p,q]=values;
        verify(item,[Math.round((q-p)*10)/10,q]);
      }else assert.fail(t.id);
    }
  }
});

test('probe answers retain exact fractions and are parseable without hidden oracle conventions',()=>{
  const answers={ 'number.percent':'800','model.formula-units':'150','model.text':'4','finance.debt':'400','finance.savings':'231',
    'probability.finite':'1/3','probability.conditional':'2/5','probability.combinatorics':'12','data.statistics':'5','sequence.progressions':'26',
    'model.optimization':'2','probability.discrete':'4','distribution.uniform':'1/4','distribution.exponential':'3/4','distribution.normal':'228/10000','distribution.cdf':'1/2' };
  for(const family of families)assert.equal(checkNumericAnswer(answers[family.id],family.lesson.probe.answer).status,'correct',family.id);
});

test('conditional examples and probes ask for both draws rather than only the conditional second draw', () => {
  const enumerate = prompt => {
    const [white, black] = nums(prompt);
    const balls = Array.from({ length: white+black }, (_, i) => i < white);
    const pairs = balls.flatMap((first, i) => balls.flatMap((second, j) => i === j ? [] : [{ first, second }]));
    const firstWhite = pairs.filter(pair => pair.first);
    const bothWhite = firstWhite.filter(pair => pair.second);
    return { joint: ratio(bothWhite.length, pairs.length), conditional: ratio(bothWhite.length, firstWhite.length) };
  };
  for (let seed = 0; seed < 12; seed++) {
    const item = createInstance('probability.conditional', seed);
    assert.equal(item.version, 3);
    if (item.templateId !== 'without-replacement') continue;
    const { example, probe } = item.lesson;
    const exampleResult = example.solution.match(/\d+\/\d+/g).at(-1);
    assert.equal(checkNumericAnswer(enumerate(example.prompt).joint, exampleResult).status, 'correct');
    const counted = enumerate(probe.prompt);
    assert.equal(checkNumericAnswer(counted.joint, probe.answer).status, 'correct');
    assert.equal(checkNumericAnswer(counted.conditional, probe.answer).status, 'incorrect', 'a conditional probability alone omits the first draw');
  }
});

test('geometric total exercises carry their own sum example and probe through ordinary assignment', () => {
  const expand = prompt => {
    const [first, multiplier, count] = nums(prompt);
    let current = first, total = 0;
    for (let i = 0; i < count; i++) {
      total += current;
      if (i+1 < count) current *= multiplier;
    }
    return { total, last: current };
  };
  let geometric = 0;
  for (let seed = 0; seed < 12; seed++) {
    const item = createInstance('sequence.progressions', seed);
    assert.equal(item.version, 2);
    if (item.templateId !== 'geometric-total') continue;
    geometric++;
    const { example, probe } = item.lesson;
    assert.notDeepEqual(probe, get(item.familyId).lesson.probe, 'a geometric sum exercise must not inherit the arithmetic sum probe');
    assert.equal(expand(example.prompt).total, nums(example.solution).at(-1));
    const counted = expand(probe.prompt);
    assert.equal(checkNumericAnswer(String(counted.total), probe.answer).status, 'correct');
    assert.equal(checkNumericAnswer(String(counted.last), probe.answer).status, 'incorrect', 'the final term is not the accumulated total');
    const visible = publicLesson(item.lesson);
    assert.deepEqual(visible.probe, { prompt: probe.prompt, kind: 'number' });
  }
  assert.equal(geometric, 6);
});

test('arithmetic sum exercises retain an arithmetic sum probe rather than a geometric term', () => {
  const expand = prompt => {
    const [first, difference, count] = nums(prompt);
    const terms = Array.from({ length: count }, (_, i) => first+i*difference);
    return { total: terms.reduce((sum, value) => sum+value, 0), last: terms.at(-1) };
  };
  for (const seed of seeds) {
    const item = createInstance('sequence.progressions', seed, 'arithmetic-sum');
    const { probe } = item.lesson;
    const counted = expand(probe.prompt);
    assert.equal(checkNumericAnswer(String(counted.total), probe.answer).status, 'correct');
    assert.equal(checkNumericAnswer(String(counted.last), probe.answer).status, 'incorrect');
    assert.equal(checkNumericAnswer(probe.answer, item.parts[0].expected).status, 'incorrect', 'the small probe must not disclose the current task answer');
  }
});

test('variance example and probe agree with weighted deviations and reject the mean shortcuts', () => {
  const moments = prompt => {
    const [first, firstWeight, second, secondWeight] = nums(prompt);
    const weights = [[first, firstWeight], [second, secondWeight]];
    assert.equal(firstWeight+secondWeight, 1);
    const mean = weights.reduce((sum, [value, weight]) => sum+value*weight, 0);
    return {
      mean,
      variance: weights.reduce((sum, [value, weight]) => sum+(value-mean)**2*weight, 0),
      secondMoment: weights.reduce((sum, [value, weight]) => sum+value**2*weight, 0),
    };
  };
  for (const templateId of ['three-point', 'indicator']) {
    const item = createInstance('probability.discrete', 0, templateId);
    assert.equal(item.version, 2);
    const { example, probe } = item.lesson;
    const exampleMoments = moments(example.prompt);
    assert.equal(exampleMoments.variance, nums(example.solution).at(-1));
    const counted = moments(probe.prompt);
    assert.equal(checkNumericAnswer(String(counted.variance), probe.answer).status, 'correct');
    for (const wrong of [counted.mean, counted.secondMoment-counted.mean]) {
      assert.equal(checkNumericAnswer(String(wrong), probe.answer).status, 'incorrect');
    }
  }
});

test('ordinary task creation keeps each short probe on the current numeric method', () => {
  const seen = new Set();
  for (const familyId of ['number.percent', 'model.text']) for (let seed = 0; seed < 36; seed++) {
    const item = createInstance(familyId, seed), probe = item.lesson.probe;
    const a = nums(probe.prompt), given = Number(probe.answer);
    let expected;
    switch (item.templateId) {
      case 'discount': {
        assert.equal(a.length, 2);
        const [price, percent] = a;
        expected = Array.from({ length: 100-percent }, () => price/100).reduce((sum, value) => sum+value, 0);
        break;
      }
      case 'reverse': {
        assert.equal(a.length, 2);
        const [percent, finalPrice] = a;
        const candidates = Array.from({ length: 1000 }, (_, i) => i+1).filter(price => price*(100-percent) === finalPrice*100);
        assert.equal(candidates.length, 1);
        [expected] = candidates;
        break;
      }
      case 'successive': {
        assert.equal(probe.kind, 'choice');
        seen.add(item.templateId);
        continue; // Its reasoning choices have a separate mathematical oracle below.
      }
      case 'meeting': {
        assert.equal(a.length, 3);
        const [firstSpeed, secondSpeed, distance] = a;
        expected = distance/(firstSpeed+secondSpeed);
        break;
      }
      case 'joint-work': {
        assert.equal(a.length, 2);
        const [firstTime, secondTime] = a;
        // Check the offered time by completed work, not by the lesson's time formula.
        assert.equal(given/firstTime + given/secondTime, 1);
        assert.ok(given > 0 && given < Math.min(firstTime, secondTime));
        expected = given;
        break;
      }
      case 'mixture': {
        assert.equal(a.length, 4);
        const [firstMass, firstPercent, secondMass, secondPercent] = a;
        // The answer must conserve the actual amount of solute.
        assert.equal((firstMass+secondMass)*given, firstMass*firstPercent+secondMass*secondPercent);
        expected = given;
        break;
      }
      default: assert.fail(item.templateId);
    }
    assert.equal(checkNumericAnswer(String(expected), probe.answer).status, 'correct', `${item.id}: probe disagrees with its own quantities`);
    if (item.templateId !== 'meeting') {
      assert.ok(item.lesson.example.prompt && item.lesson.example.solution && probe.explanation);
      seen.add(item.templateId);
    }
  }
  assert.deepEqual([...seen].sort(), ['discount', 'joint-work', 'mixture', 'reverse', 'successive']);
});

test('successive contrast changes only the second base and exposes precisely that failed transition', () => {
  const item = createInstance('number.percent', 2), { probe } = item.lesson;
  assert.equal(item.templateId, 'successive');
  assert.equal(item.version, 3);
  const [initial, rise, decrease] = nums(probe.prompt.split('\n\nА:')[0]);
  const raised = initial+initial*rise/100;
  const finals = { a: raised-raised*decrease/100, b: raised-initial*decrease/100 };
  assert.deepEqual([raised, finals.a, finals.b], [300, 150, 200]);
  const transitions = new Map([
    ['1', raised === initial*(1+rise/100)],
    ['2', finals.b === raised*(1-decrease/100)],
    ['3', initial === 200], // The common initial comparison price remains unchanged.
  ]);
  const failed = [...transitions].filter(([, holds]) => !holds).map(([id]) => id);
  assert.deepEqual(failed, [probe.answer]);
  assert.deepEqual(probe.choices.map(choice => choice.id), [...transitions.keys()]);
  for (const { id, label } of probe.choices) {
    assert.ok(label);
    assert.equal(checkPart({ id: 'probe', kind: probe.kind, check: probe.kind, expected: probe.answer }, id).status, failed.includes(id) ? 'correct' : 'incorrect');
  }
  for (const templateId of ['discount', 'reverse']) {
    const other = createInstance('number.percent', 2, templateId).lesson.probe;
    assert.equal(other.kind, 'number');
    assert.equal(other.choices, undefined);
  }
});

test('public percentage contrast retains choices and hides the private key and explanation', () => {
  const { lesson } = createInstance('number.percent', 2);
  const visible = publicLesson(lesson);
  assert.equal(visible.probe.kind, 'choice');
  assert.deepEqual(visible.probe.choices, lesson.probe.choices);
  assert.equal(Object.hasOwn(visible.probe, 'answer'), false);
  assert.equal(Object.hasOwn(visible.probe, 'explanation'), false);
  assert.equal(JSON.stringify(visible).includes(lesson.probe.explanation), false);
  for (const { label } of visible.probe.choices) assert.equal(visible.probe.prompt.includes(label), false, 'choices belong in their own field');
});

test('source weights and finance lesson examples agree with counted details and chronological ledgers', () => {
  const byTemplate = new Map();
  for (const familyId of ['probability.conditional', 'finance.debt', 'finance.savings']) {
    for (let seed = 0; seed < 12; seed++) {
      const item = createInstance(familyId, seed);
      byTemplate.set(item.templateId, item.lesson);
    }
  }
  const weighted = byTemplate.get('total-probability');
  const [sourcePercent, firstMarked, secondMarked] = nums(weighted.example.prompt);
  // A deterministic model cohort: enumerate each source's marked and unmarked details.
  const cohort = Array.from({ length: 1000 }, (_, i) => {
    const first = i < sourcePercent*10;
    return first ? i < sourcePercent*firstMarked/10 : i-sourcePercent*10 < (100-sourcePercent)*secondMarked/10;
  });
  const exampleProbability = Number(/вероятность (\d+,\d+)/.exec(weighted.example.solution)[1].replace(',', '.'));
  assert.equal(cohort.filter(Boolean).length/1000, exampleProbability);
  const [sourceShare, markedShare] = nums(weighted.probe.prompt);
  const firstSource = Array.from({ length: sourceShare*10 }, (_, i) => i < sourceShare*markedShare/10);
  assert.equal(checkNumericAnswer(String(firstSource.filter(Boolean).length/10), weighted.probe.answer).status, 'correct');

  const payments = byTemplate.get('two-equal-payments');
  const [principal, rate] = nums(payments.example.prompt);
  const payment = Number([...payments.example.solution.matchAll(/P=(\d+)/g)].at(-1)[1]);
  let debt = principal*100;
  const returnedPrincipal = [];
  for (let year = 0; year < 2; year++) {
    const before = debt;
    debt = debt*(100+rate)/100-payment*100;
    returnedPrincipal.push((before-debt)/100);
  }
  assert.equal(debt, 0);
  assert.notEqual(returnedPrincipal[0], returnedPrincipal[1], 'equal payments need not repay equal principal');
  const [remaining, lastRate] = nums(payments.probe.prompt);
  assert.equal(Number(payments.probe.answer)*100, remaining*(100+lastRate));

  const lastNumber = text => nums(text).at(-1);
  const compound = byTemplate.get('compound');
  for (const [prompt, result] of [[compound.example.prompt, lastNumber(compound.example.solution)], [compound.probe.prompt, Number(compound.probe.answer)]]) {
    const [initial, percent] = nums(prompt);
    let cents = initial*100;
    for (let period = 0; period < 2; period++) cents += cents*percent/100;
    assert.equal(cents/100, result);
  }
  const contributions = byTemplate.get('beginning-contributions');
  const [deposit, percent] = nums(contributions.example.prompt);
  let cents = 0;
  for (let period = 0; period < 3; period++) {
    cents += deposit*100;
    cents += cents*percent/100;
  }
  assert.equal(cents/100, lastNumber(contributions.example.solution));
  const [lastDeposit, lastPercent] = nums(contributions.probe.prompt);
  assert.equal(Number(contributions.probe.answer)*100, lastDeposit*(100+lastPercent));
});

test('interval and jump exercises require different probabilities across variants', () => {
  for (const [familyId, templateId] of [['distribution.uniform', 'clipped-interval'], ['distribution.cdf', 'linear-cdf']]) {
    const template = get(familyId).templates.find(item => item.id === templateId);
    const values = new Set();
    let touchesSupportEnd = false;
    for (let seed = 0; seed < 24; seed++) {
      const item = template.build(seed);
      if (templateId === 'clipped-interval') {
        const [left, right, low, high] = nums(item.prompt);
        // Count equal-length unit cells, rather than trusting the generator's fraction.
        const cells = Array.from({ length: right-left }, (_, i) => left+i+0.5);
        const hits = cells.filter(x => low <= x && x <= high).length;
        verify(item, [ratio(hits, cells.length)]);
        assert.ok(low < left && high <= right);
      } else {
        const [, start, width] = /F\(x\)=\(x−(\d+)\)\/(\d+)/.exec(item.prompt);
        const [low, high] = nums(item.prompt.slice(item.prompt.indexOf('Найдите')));
        const left = Number(start), length = Number(width);
        const cells = Array.from({ length }, (_, i) => left+i+0.5);
        verify(item, [ratio(cells.filter(x => low < x && x <= high).length, length)]);
        if (high === left+length) touchesSupportEnd = true;
      }
      values.add(item.parts[0].expected);
    }
    assert.ok(values.size >= 3, `${familyId}/${templateId}: a fixed answer lets the learner skip the interval`);
    if (templateId === 'linear-cdf') assert.ok(touchesSupportEnd, 'include the transition to F=1');
  }
  const jump = get('distribution.cdf').templates.find(item => item.id === 'jump-cdf');
  const pointProbabilities = new Set(Array.from({ length: 24 }, (_, seed) => jump.build(seed).parts[0].expected));
  assert.ok(pointProbabilities.size >= 3, 'the probability of the atom must not always be the same jump');
});

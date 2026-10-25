import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateDebtModel} from '../../shared/debt-model.mjs'
import {createInstance,publicInstance,publicLesson} from './registry.mjs'
test('two payments accrue on the actual remainder without rounding the proposed payment',()=>{
  const result=evaluateDebtModel({principal:21000,rate:10},'11550')
  assert.deepEqual(result.steps.map(step=>step.amount),[21000,23100,11550,12705,1155])
  assert.equal(result.outcome,'remaining');assert.equal(result.mastery,false)
  assert.equal(evaluateDebtModel({principal:21000,rate:10},'12100').outcome,'settled')
  assert.equal(evaluateDebtModel({principal:44000,rate:20},'28800').outcome,'settled')
  // Independent decimal-cent oracle for these integer generated amounts.
  for(const payment of [100,11550,12100,13000,23099]){
    const actual=evaluateDebtModel({principal:21000,rate:10},String(payment))
    assert.equal(actual.finalBalance,((21000*110-payment*100)*110-payment*10000)/10000)
  }
  assert.notEqual(evaluateDebtModel({principal:21000,rate:10},'12100.000000000001').status,'correct')
  assert.equal(evaluateDebtModel({principal:21,rate:10},'12,1').status,'correct')
})
test('early payoff stops before a second interest event, and overpayment stays visible',()=>{
  for(const input of ['23100','30000']){const result=evaluateDebtModel({principal:21000,rate:10},input);assert.equal(result.outcome,'early');assert.equal(result.steps.length,3);assert.equal(result.status,'incorrect')}
  const over=evaluateDebtModel({principal:21000,rate:10},'13000')
  assert.equal(over.outcome,'overpaid');assert.ok(over.finalBalance<0)
  assert.equal(evaluateDebtModel({principal:100,rate:0},'50').status,'correct')
})
test('bounded parsing rejects coercion, malformed or unsupported amounts and facts',()=>{
  for(const input of ['', ' ', 'NaN','Infinity','1/2','12100 рублей','1e4','1,2,3','1'.repeat(121),'0.0000000000001','1000000000001'])assert.equal(evaluateDebtModel({principal:21000,rate:10},input).status,'unknown',input)
  for(const input of ['-1','0'])assert.equal(evaluateDebtModel({principal:21000,rate:10},input).status,'incorrect')
  for(const facts of [{principal:NaN,rate:10},{principal:1,rate:101},{principal:0,rate:10},{principal:1e10,rate:10}])assert.equal(evaluateDebtModel(facts,'1').status,'unknown')
})
test('facts are frozen from actual template parameters, available only in explicit help',()=>{
  for(let seed=0;seed<15;seed++){
    const instance=createInstance('finance.debt',seed,'two-equal-payments'),descriptor=instance.lesson.interaction
    assert.equal(evaluateDebtModel(descriptor.facts,String(instance.parts[0].expected)).status,'correct')
    assert.equal(publicInstance(instance).interaction,undefined)
    assert.equal(publicInstance(instance,{concealMethod:true}).stepModelAvailable,undefined)
    assert.deepEqual(publicLesson(instance.lesson).interaction,descriptor)
  }
  assert.equal(createInstance('finance.debt',0,'equal-principal').lesson.interaction,undefined)
})

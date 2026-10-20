import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultLearningNavigation, addressedEpisodeNavigation, episodeCompletion, readLearningNavigation} from './learning-navigation.ts'
test('addressed episode returns to work instead of forcing the course',()=>{
 const nav=addressedEpisodeNavigation(defaultLearningNavigation(),{view:'work',episodeId:null})
 assert.deepEqual(episodeCompletion(nav,'K6'),{view:'work',episodeId:null})
})
test('only full beginner course chains episodes and finishes at preserved work',()=>{
 const nav={...defaultLearningNavigation(),episodeReturn:'course' as const}
 assert.deepEqual(episodeCompletion(nav,'K6'),{view:'episode',episodeId:'K7'})
 assert.deepEqual(episodeCompletion(nav,'M1'),{view:'work',episodeId:null})
})
test('material and diagnostic return points survive serialisation',()=>{
 const nav={...defaultLearningNavigation(),resume:{view:'diagnostic' as const,episodeId:null},materialReturn:{view:'episode' as const,episodeId:'K2'}}
 const restored=readLearningNavigation(JSON.stringify(nav))
 assert.deepEqual(restored.resume,{view:'diagnostic',episodeId:null})
 assert.deepEqual(episodeCompletion(addressedEpisodeNavigation(restored,{view:'materials',episodeId:'K2'}),'K6'),{view:'episode',episodeId:'K2'})
 assert.deepEqual(episodeCompletion(addressedEpisodeNavigation(restored,{view:'diagnostic',episodeId:null}),'K6'),{view:'diagnostic',episodeId:null})
})
test('invalid navigation never silently replaces a valid return point',()=>{
 assert.throws(()=>readLearningNavigation('{'))
 assert.throws(()=>readLearningNavigation(JSON.stringify({...defaultLearningNavigation(),resume:{view:'episode',episodeId:null}})))
})

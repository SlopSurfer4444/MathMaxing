import { BookOpen, ChevronRight } from 'lucide-react'
import { KnowledgeDiagram } from './KnowledgeDiagram'
import { MathContent } from './MathContent'
import type { ExamMaterialLesson } from '../exam-ui-types'

/** Renders the server-frozen article. Navigation stays in the learning runtime. */
export function ExamMaterialArticle({lesson,onNavigate,disabled}:{lesson:ExamMaterialLesson;onNavigate(id:string):void;disabled:boolean}) {
  const {article,relations}=lesson.material
  const links=(ids:string[])=>ids.map(id=>{
    const item=lesson.materials.find(link=>link.id===id)
    return item?<button key={id} type="button" disabled={disabled} onClick={()=>onNavigate(id)}><BookOpen size={14}/>{item.title}<ChevronRight size={14}/></button>:null
  })
  return <div className="exam-material-article">
    <MathContent text={article.explanation}/>
    {article.diagram&&<KnowledgeDiagram kind={article.diagram}/>}
    <MathContent text={article.statement}/>
    <MathContent text={`$$${article.formula}$$`}/>
    {!!relations.prerequisites.length&&<nav className="exam-prerequisites" aria-label="Основы для этой статьи"><h2>Если нужно вспомнить</h2>{links(relations.prerequisites)}</nav>}
    {article.sections?.map(section=><section key={section.title}><h2>{section.title}</h2><MathContent text={section.text}/>{section.formula&&<MathContent text={`$$${section.formula}$$`}/>}</section>)}
    <details><summary>Почему это работает</summary>{article.proof.map((step,index)=><div className="exam-article-proof-step" key={index}><span>{index+1}</span><div><MathContent text={step.text}/>{step.formula&&<MathContent text={`$$${step.formula}$$`}/>}</div></div>)}</details>
    <aside className="exam-article-caution"><MathContent text={article.caution}/></aside>
    {!!relations.related.length&&<nav className="exam-prerequisites" aria-label="Связанные понятия"><h2>Связанные понятия</h2>{links(relations.related)}</nav>}
    {article.diagram==='circle'&&<p className="exam-muted">Если спрашиваешь про положение точки, укажи угол в вопросе — наставник не видит ползунок.</p>}
  </div>
}

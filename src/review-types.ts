export type ReviewAnchor={kind:'answer_a'|'answer_b'|'numeric'|'block';blockId?:string;quote:string}
export type ReviewObjection={id:string;requestId:string;explanation:string;createdAt:string;status:'pending'|'ready'|'failed';verdict?:'withdrawn'|'upheld'|'uncertain';message?:string;error?:string}
export type ReviewFinding={id:string;anchor:ReviewAnchor;message:string;suggestion?:string;source:'model';status:'open'|'withdrawn'|'upheld'|'uncertain';objections:ReviewObjection[]}

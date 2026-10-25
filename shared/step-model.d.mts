export type StepModelDescriptor = {id:'debt-two-payments';version:1;kind:'debt-two-payments';title:string;facts:{principal:number;rate:number}} | {id:'converse-parallel';version:1;kind:'converse-parallel';title:string;facts:{ad:number;db:number;ae:number;ec:number}}
export type StepModelState = {input:string;choice:string;reveal:number}
export type StepModelResult = {status:string;summary:string;scope:string;mastery:false;source?:string;createdAt?:string;provenance?:string}
export function publicStepModel(value:unknown):StepModelDescriptor|null

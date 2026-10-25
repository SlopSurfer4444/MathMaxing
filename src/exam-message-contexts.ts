/** Annotation numbers restart for each question. Never bind them to chat-global order. */
export function examMessageContexts<T extends {id:string;role:string;contexts?:C[]},C>(messages:T[],messageId:string):C[] {
  const index=messages.findIndex(message=>message.id===messageId)
  if(index<0)return []
  const message=messages[index]
  if(message.contexts?.length)return message.contexts
  if(message.role==='user')return []
  for(let cursor=index-1;cursor>=0;cursor--) {
    if(messages[cursor].role==='user')return messages[cursor].contexts??[]
  }
  return []
}

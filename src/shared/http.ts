import type { IncomingMessage, ServerResponse } from 'node:http';
export async function readJson(req: IncomingMessage, limit=65536):Promise<any> {
 let data='';let bytes=0;
 for await(const chunk of req) {bytes+=chunk.length;if(bytes>limit)throw new Error('Request too large');data+=chunk;}
 return JSON.parse(data || '{}');
}
export function json(res:ServerResponse,status:number,value:unknown) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}

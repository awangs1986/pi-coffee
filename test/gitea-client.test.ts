import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { GiteaClient } from "../src/host/gitea.js";

let server:ReturnType<typeof createServer>|undefined;
afterEach(async()=>{if(server){server.close();await once(server,"close");server=undefined;}});

describe("Gitea code collaboration adapter",()=>{
  it("creates repositories and returns an existing pull request idempotently",async()=>{
    const requests:Array<{method?:string;url?:string;body:string}>=[];
    server=createServer((request,response)=>{
      let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{
        requests.push({method:request.method,url:request.url,body});response.setHeader("content-type","application/json");
        if(request.url==="/api/v1/user/repos")return response.end(JSON.stringify({id:9,name:"demo",default_branch:"main",clone_url:"http://gitea/a/demo.git",html_url:"http://gitea/a/demo"}));
        if(request.url?.includes("/pulls?"))return response.end(JSON.stringify([{number:4,html_url:"http://gitea/a/demo/pulls/4",state:"open",head:{ref:"coffee/vm/c1"},base:{ref:"main"}}]));
        response.statusCode=500;response.end('{}');
      });
    });server.listen(0,"127.0.0.1");await once(server,"listening");
    const address=server.address();if(!address || typeof address==="string")throw new Error("missing address");
    const client=new GiteaClient({baseUrl:`http://127.0.0.1:${address.port}`,token:"secret",owner:"a"});
    expect(await client.createRepository("demo")).toMatchObject({repoId:"9",branch:"main",repoUrl:"http://gitea/a/demo.git"});
    expect(await client.createPullRequest({id:"9",name:"demo",path:"",branch:"main",repoId:"9",repoUrl:"http://gitea/a/demo.git"},"coffee/vm/c1","main","Ready")).toMatchObject({number:4,url:"http://gitea/a/demo/pulls/4"});
    expect(requests.map(item=>item.url)).toContain("/api/v1/repos/a/demo/pulls?state=open&head=a%3Acoffee%2Fvm%2Fc1&base=main");
  });
});

import type { CodeForge, Project, PullRequest } from "./workspaces.js";

export interface RepositoryRegistration {repoId:string;name:string;repoUrl:string;webUrl:string;branch:string}
export interface GiteaOptions {baseUrl:string;token:string;owner:string}

export class GiteaClient implements CodeForge {
  private readonly base:URL;
  constructor(private readonly options:GiteaOptions) {
    this.base=new URL(options.baseUrl);
    if(!['http:','https:'].includes(this.base.protocol) || this.base.username || this.base.password)throw new Error('Gitea base URL must be credential-free HTTP(S)');
    if(!options.token || !/^[A-Za-z0-9_.-]+$/.test(options.owner))throw new Error('Gitea token and owner are required');
  }
  async createRepository(name:string):Promise<RepositoryRegistration> {
    const repo=await this.request('/api/v1/user/repos','POST',{name,private:true,auto_init:false}) as Record<string,unknown>;
    return this.registration(repo);
  }
  async migrateRepository(name:string,sourceUrl:string):Promise<RepositoryRegistration> {
    const repo=await this.request('/api/v1/repos/migrate','POST',{clone_addr:sourceUrl,repo_name:name,repo_owner:this.options.owner,mirror:false,service:'git'}) as Record<string,unknown>;
    return this.registration(repo);
  }
  async createPullRequest(project:Project,source:string,target:string,title:string):Promise<PullRequest> {
    let owner=this.options.owner,name=project.name;
    if(project.repoId){
      const repo=await this.request(`/api/v1/repositories/${encodeURIComponent(project.repoId)}`,'GET') as {owner?:{login?:string};name?:string};
      if(!repo.owner?.login || !repo.name)throw new Error('Gitea repository identity unavailable');
      owner=repo.owner.login;name=repo.name;
    }
    const path=`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
    const query=new URLSearchParams({state:'open',head:`${owner}:${source}`,base:target});
    const existing=await this.request(`${path}?${query}`,'GET') as Array<Record<string,unknown>>;
    const pull=existing[0] ?? await this.request(path,'POST',{head:source,base:target,title}) as Record<string,unknown>;
    return {number:Number(pull.number),url:String(pull.html_url),state:String(pull.state),source,target};
  }
  private registration(repo:Record<string,unknown>):RepositoryRegistration {
    const branch=String(repo.default_branch || 'main');
    return {repoId:String(repo.id),name:String(repo.name),repoUrl:String(repo.clone_url),webUrl:String(repo.html_url),branch};
  }
  private async request(path:string,method:string,body?:unknown):Promise<unknown> {
    const url=new URL(path,this.base);
    const response=await fetch(url,{method,headers:{authorization:`token ${this.options.token}`,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000),redirect:'error'});
    const text=await response.text();let value:unknown={};try{value=text ? JSON.parse(text) : {};}catch{}
    if(!response.ok)throw new Error(`Gitea ${method} ${url.pathname} failed (${response.status})`);
    return value;
  }
}

import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "@observability-gate/core";
import { createBuiltInGateCatalog } from "@observability-gate/gates";
import { createPolicyProviderSession, type ProviderPolicy, type KubernetesReadClient, type ContainerAppsReadClient } from "@observability-gate/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeObservabilityStack } from "../integration/fake-observability-stack.js";

const now=Date.now(),timestamp=new Date(now).toISOString(),digest=`sha256:${"a".repeat(64)}`;
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const encoded=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
let root:string;
const catalog=createBuiltInGateCatalog();
const kube:KubernetesReadClient={readWorkload:async()=>({kind:"Deployment",metadata:{name:"checkout",namespace:"shop",uid:"deployment",generation:1,labels:{"app.kubernetes.io/version":"release-candidate"}},spec:{replicas:1},status:{observedGeneration:1,replicas:1,updatedReplicas:1,readyReplicas:1,availableReplicas:1,conditions:[{type:"Available",status:"True"}]}}),listReplicaSets:async()=>({items:[]}),listPods:async()=>({items:[]}),listEvents:async()=>({items:[]})};
const aca:ContainerAppsReadClient={getApp:async()=>({provisioningState:"Succeeded",configuration:{ingress:{traffic:[{revisionName:"checkout--release-candidate",weight:100}]}}}),listRevisions:async function*(){yield {name:"checkout--release-candidate",provisioningState:"Provisioned",runningState:"Running",active:true,template:{containers:[{image:`image@${digest}`}]}};},listReplicas:async()=>[{runningState:"Running",containers:[{ready:true,restartCount:0}]}]};
function policy(type:string):ProviderPolicy{return {identity:{canonical:{service_name:"checkout",service_namespace:"commerce",environment:"production",release_id:"release-candidate",deployment_id:"deploy"},provider_mappings:{metrics:{"service.name":"service_name","service.namespace":"service_namespace","service.version":"service_version","deployment.environment.name":"deployment_environment"}}},release:{candidate:{deployed_at:new Date(now-60000).toISOString()},baseline:{explicit_release_id:"release-baseline"}},observation:{},execution:{active_target:"target"},targets:{definitions:{target:{runtime:{type,namespace:"shop",workload:{kind:"Deployment",name:"checkout"},resource_group:"rg",application_name:"checkout",revision_name:"checkout--release-candidate",virtual_machine_name:"vm",expected_hosts:["host"],expected:{image_digest:digest,artifact_digest:digest,release_marker:"release-candidate",rollback_artifact:"previous.tar"},artifacts:{rendered_manifests:["workload.yml"],rendered_configuration:["app.json"],service_definition:["service.json"],runtime_evidence:["runtime.json"]},operating_system:"windows"}}}},providers:{telemetry:{metrics:{endpoint:"https://metrics.example.test"},logs:{endpoint:"https://logs.example.test"},traces:{endpoint:"https://traces.example.test"},grafana:{endpoint:"https://grafana.example.test"}},http:{probe:{allowed_hosts:["service.example.test"]}},evidence:{deployment:{files:["deployment.jws"],signature:{trusted_issuer:"https://issuer.example.test",jwks_url:"https://issuer.example.test/jwks",workflow_identity:"workflow",audience:"observegate"}}}},gates:{pre_deployment:[],post_deployment:[]},reporting:{},security:{},limits:{}};}
function definition(kind:string):Record<string,unknown>{
  const base={type:kind,source:{provider:"metrics",query:"up"},assertions:{}};
  const files:Record<string,string>={"asset.metadata":"catalog.yml","evidence.sarif":"findings.sarif","evidence.incident_state":"incidents.json","evidence.otlp_contract":"otlp.json","synthetic.result":"synthetic.json","synthetic.plan":"plan.json","telemetry.pipeline_configuration":"collector.json"};
  if(files[kind])return {...base,source:{files:[files[kind]]}};
  if(kind==="asset.url"||kind==="http.assertion")return {...base,source:{provider:"probe",url:"https://service.example.test/health"},assertions:{expected_status:[200]}};
  if(kind.startsWith("grafana."))return {...base,source:{provider:"grafana",uid:"checkout",match:{service:"checkout"}},assertions:kind==="grafana.burn_rate"?{windows:[{short_query:"short",long_query:"long",maximum:1}]}:{}};
  if(kind==="policy.change_window")return {...base,timezone:"UTC",freezes:[]};
  if(kind==="dependency.health")return {...base,dependencies:[{name:"db",query:"db_up",threshold:{greater_than_or_equal:0}}]};
  if(["metric.multi_threshold","runtime.capacity","telemetry.collector_health","telemetry.cardinality_estimate","telemetry.volume_estimate"].includes(kind))return {...base,source:{provider:"metrics",queries:{cpu:"cpu",cpu_percent:"cpu_percent",memory_percent:"memory_percent",disk_percent:"disk_percent",surge_schedulable:"surge_schedulable",export_failures:"export_failures",refused_data:"refused_data",queue_utilization:"queue_utilization",estimate:"estimate"}},assertions:{budget:100,thresholds:{cpu:{less_than_or_equal:1}}}};
  if(kind==="providers.health")return {...base,source:{probes:{metrics:{query:"up"},logs:{query:'{service="checkout"}'},traces:{},grafana:{uid:"checkout"}}}};
  if(kind==="telemetry.service_graph")return {...base,source:{provider:"traces",caller:"frontend"}};
  if(["telemetry.freshness","telemetry.correlation","telemetry.identity_consistency","telemetry.contract"].includes(kind))return {...base,source:{queries:{metrics:"up",logs:'{service="checkout"}'},files:["otlp.json"]}};
  if(kind==="comparison.metric")return {...base,source:{provider:"metrics",candidate:{query:"candidate"},baseline:{query:"baseline"}}};
  if(kind==="comparison.multi_metric"||kind==="comparison.telemetry_volume")return {...base,source:{queries:{cpu:{candidate:{query:"candidate",request_count_query:"candidate_requests"},baseline:{query:"baseline",request_count_query:"baseline_requests"},unit:"seconds"}}}};
  if(kind==="comparison.trace_metrics")return {...base,source:{provider:"traces"},assertions:{dependencies:["payments"]}};
  if(kind==="azure_container_apps.replica_health")return {...base,source:{adapter:"active",queries:{activation_failures:"activation_failures",deactivation_failures:"deactivation_failures"}}};
  return base;
}
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),"observegate-catalog-"));
  const files:Record<string,unknown>={"catalog.yml":{kind:"Component",metadata:{annotations:{"observability-gate/escalation-contact":"oncall@example.test"}},spec:{owner:"commerce"}},"service.json":{automaticRestart:true,restartDelaySeconds:5,startupTimeoutSeconds:60,gracefulShutdownSeconds:30,identity:"service-user",telemetryAgentDependency:true,serviceVersionDeclared:true},"incidents.json":{incidents:[]},"synthetic.json":{tests:[{name:"checkout",status:"passed",durationMs:5,observedRelease:"release-candidate"}]},"plan.json":{checks:[{timeout:"5s",expected_status:[200],expected_release:"release-candidate"}]},"collector.json":{receivers:{otlp:{}},processors:{memory_limiter:{},batch:{}},exporters:{otlp:{endpoint:"https://collector.example.test",retry_on_failure:{enabled:true},sending_queue:{enabled:true}}},service:{pipelines:{metrics:{exporters:["otlp"]},logs:{exporters:["otlp"]},traces:{exporters:["otlp"]}}}},"runtime.json":{hosts:[{hostId:"host",cpuPercent:10,memoryPercent:20,diskPercent:30,load:0.1}],services:[{hostId:"host",manager:"windows",name:"checkout",state:"running",exitCode:0,restarts:0}],agents:[{hostId:"host",up:true,exportFailures:0,queueUtilizationPercent:5,lastExportAt:timestamp}],releases:[{hostId:"host",releaseId:"release-candidate"}]}};
  for(const[name,value]of Object.entries(files))await writeFile(join(root,name),JSON.stringify(value));
  for(const[name,path]of Object.entries({"workload.yml":"fixtures/manifests/kubernetes/workload.yml","app.json":"fixtures/manifests/container-apps/app.json","findings.sarif":"fixtures/evidence/sarif/instrumentation.sarif"}))await writeFile(join(root,name),await readFile(path));
  const otlp=JSON.parse(await readFile("fixtures/evidence/otlp/contract.json","utf8"));otlp.provenance={commit:"release-candidate",workflow:"deploy"};otlp.resource["service.version"]="release-candidate";otlp.resource["service.namespace"]="commerce";await writeFile(join(root,"otlp.json"),JSON.stringify(otlp));
  const header=encoded({alg:"RS256",kid:"key"}),body=encoded({iss:"https://issuer.example.test",aud:"observegate",sub:"deployment",target:"target",deploymentId:"deploy",commit:"release-candidate",releaseId:"release-candidate",artifactDigest:digest,deployedAt:new Date(now-60000).toISOString(),workflowIdentity:"workflow",iat:now/1000,exp:(now+600000)/1000});await writeFile(join(root,"deployment.jws"),`${header}.${body}.${sign("RSA-SHA256",Buffer.from(`${header}.${body}`),keys.privateKey).toString("base64url")}`);
});
afterAll(async()=>{await rm(root,{recursive:true,force:true});});
describe("all registered gate acquisition routes",()=>{
  it.each(Object.entries(catalog.metadata()))("%s acquires through a read-only adapter",async(kind,metadata)=>{
    const type=kind.startsWith("azure_container_apps.")?"azure_container_apps":kind==="azure_vm.instance_view"?"azure_vm":kind.startsWith("vm.")?"windows_vm":"kubernetes",p=policy(type),stack=new FakeObservabilityStack("healthy",timestamp),gate=definition(kind);const fetch=async(input:string|URL)=>{
      const url=new URL(input);if(url.pathname==="/jwks")return Response.json({keys:[{...keys.publicKey.export({format:"jwk"}),kid:"key",use:"sig",alg:"RS256"}]});
      if(url.pathname.endsWith("/alerts"))return Response.json({status:"success",data:{alerts:[]}});
      if(url.pathname==="/api/v1/query"&&kind==="deployment.concurrency")return Response.json({status:"success",data:{resultType:"vector",result:[{metric:{deployment_id:"deploy"},value:[now/1000,"1"]}]}});
      return stack.fetch(url.toString());};
    const session=createPolicyProviderSession({policy:{...p,gates:{pre_deployment:[{type:"metric.threshold",source:{provider:"metrics",query:"up"}}]}},workspaceRoot:root,environment:{},fetch,resolveHostname:async()=>["203.0.113.10"],runtimeClients:{kubernetes:kube,containerApps:aca,azureVm:{getInstanceView:async()=>({statuses:[{code:"ProvisioningState/succeeded"},{code:"PowerState/running"}]})}},clock:()=>now});
    const raw=await session.resolveEvidence?.(kind,gate,{phase:metadata.supportedPhases[0]??"post_deployment",targetId:"target",releaseId:"release-candidate",evidenceStore:new EvidenceStore(()=>new Date(now)),signal:new AbortController().signal,clock:()=>new Date(now)});
    expect(raw?.[0]?.state).toBe("valid");expect(raw?.[0]?.kind).not.toBe("unsupported");expect(raw?.[0]?.source.provider).not.toBe("unresolved");
  });
});


const url = "https://api.github.com/repos/kkieren999/IronGate-Pool-Inspections/actions/workflows/deploy-stripe-payments.yml/runs?per_page=6";
const response = await fetch(url, { headers: { "Accept": "application/vnd.github+json", "User-Agent": "IronGate-deploy-check" }, signal: AbortSignal.timeout(12000) });
if (!response.ok) throw Error("GitHub deployments API HTTP " + response.status);
const data = await response.json();
for(const run of data.workflow_runs||[]){
 console.log(JSON.stringify({id:run.id,head_sha:run.head_sha,status:run.status,conclusion:run.conclusion,created_at:run.created_at,url:run.html_url}));
}

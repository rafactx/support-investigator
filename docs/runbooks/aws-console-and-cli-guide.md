# Guia AWS: onde ver e como validar

Pra quem está começando com AWS e não sabe "por onde entro pra ver o que esse projeto criou" ou "onde está o link que dá pra abrir no navegador". Complementa `docs/runbooks/cdk-destroy.md` (que cobre desligar); este cobre inspecionar e validar o que está no ar.

Tudo aqui roda contra um único stack CDK, **`SupportInvestigatorStack`**, na região **`us-east-2` (Ohio)** — a mesma conta que `CDK_ACCOUNT_ID` aponta em `.env` (ADR-0002 explica por que o account id não fica hardcoded no repo). O erro mais comum de quem começa: abrir o Console AWS e estar em outra região (ex: `us-east-1`, que é o padrão de tela pra muita gente) — aí nenhum recurso aparece, e parece que "não tem nada rodando". **Sempre confira o seletor de região no canto superior direito do Console antes de procurar qualquer coisa.**

## O mapa: o que existe e pra que serve

| Serviço | Recurso (nome no stack) | Pra que serve |
|---|---|---|
| CloudFront | `SpaDistribution` | Serve o front-end (SPA React) — **é aqui que está o link público** |
| S3 | `SpaBucket` | Guarda os arquivos estáticos do build (`web/dist`). Bucket privado, só o CloudFront acessa (via Origin Access Control) |
| API Gateway (HTTP API) | `HttpApi` | A API que o front-end e o cliente MCP chamam |
| Lambda (3 funções) | `AgentApiFunction`, `SupportMcpFunction`, `DemoKeyAuthorizerFunction` | Backend: o agente de investigação, o servidor MCP, e um autorizador que valida o header `x-demo-key` antes de deixar a requisição passar |
| Bedrock | sem recurso próprio — é permissão IAM nos Lambdas | Os Lambdas chamam modelos Claude via Converse API (ADR-0003, ADR-0016) |
| IAM | roles/policies do CDK + do stack, mais o usuário `support-investigator-deploy` | Permissões mínimas por Lambda; o usuário de deploy é o "quem" por trás de `aws sts get-caller-identity` |
| CloudFormation | `SupportInvestigatorStack` | O "recibo" de tudo isso — todo deploy/destroy passa por aqui, e é o caminho mais rápido pra achar qualquer link |

## Console: caminho por serviço

1. **CloudFormation → Stacks → `SupportInvestigatorStack` → aba Outputs.**
   Este é o atalho que vale mais a pena memorizar: os 4 links do projeto (URL do site, da API, do MCP, do endpoint de investigação) estão listados prontos aqui, sem precisar abrir mais nada.
2. **CloudFront → Distributions.** Uma distribuição só, com domínio `*.cloudfront.net` — é o link que abre no navegador.
3. **Lambda → Functions.** Procure pelas 3 funções da tabela acima (o nome completo vem prefixado com `SupportInvestigatorStack-`).
4. **API Gateway → APIs.** Um HTTP API só; o ID aparece na URL (`https://<id>.execute-api.us-east-2.amazonaws.com/`).
5. **S3 → Buckets.** O bucket do SPA não abre nada por fora — é só armazenamento, acesso público bloqueado por design.
6. **Bedrock → Model access.** Confirma quais modelos Claude estão habilitados nessa conta/região (é configuração de conta, não recurso do stack — `cdk destroy` nunca mexe aqui).

## CLI: comandos pra validar (com o que esperar de volta)

```bash
# Quem eu sou / qual conta estou autenticado
aws sts get-caller-identity

# O comando mais útil: os 4 links do stack, incluindo o link público (SpaUrl)
aws cloudformation describe-stacks \
  --stack-name SupportInvestigatorStack \
  --region us-east-2 \
  --query "Stacks[0].Outputs" \
  --output table

# Status do stack — se não existir, cai aqui com "does not exist" (ver cdk-destroy.md)
aws cloudformation describe-stacks \
  --stack-name SupportInvestigatorStack \
  --region us-east-2 \
  --query "Stacks[0].StackStatus"

# As 3 Lambdas
aws lambda list-functions --region us-east-2 \
  --query "Functions[].FunctionName"

# A distribuição CloudFront (domínio + status de propagação)
aws cloudfront list-distributions \
  --query "DistributionList.Items[].{Domain:DomainName,Status:Status}"
```

`describe-stacks --query "Stacks[0].Outputs"` é o único comando que você realmente precisa lembrar — ele devolve os outputs nomeados no próprio `support-investigator-stack.ts` (`SpaUrl`, `ApiUrl`, `SupportMcpUrl`, `InvestigateUrl`), então a resposta é sempre o estado real e atual do stack, nunca um valor congelado.

## Onde está o link público

O output chamado **`SpaUrl`** — é o link do CloudFront (`https://<algo>.cloudfront.net`), a mesma informação disponível na aba Outputs do CloudFormation ou no comando `describe-stacks` acima. Ele também é reimpresso no terminal toda vez que você roda `pnpm cdk deploy` (fim do output), então rolar o scrollback do último deploy também funciona.

**Importante:** esse domínio muda se a distribuição CloudFront for recriada (ex: depois de um `cdk destroy` seguido de novo `cdk deploy`) — por isso este guia não fixa o valor atual, só o comando pra sempre pegar o valor certo na hora.

## Custo e desligamento

Cobertos em `docs/runbooks/cdk-destroy.md` — resumo: enquanto o stack está no ar, custo é efetivamente zero fora de uso ativo (tudo pay-per-invocation, sem NAT gateway/RDS/recurso sempre-ligado). O motivo pra derrubar depois da demo é postura de segurança (ADR-0002: o endpoint público não fica no ar fora da janela de demo), não economia.

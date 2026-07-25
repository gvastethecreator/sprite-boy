# Control externo

Type: research
Status: resolved
Blocked by: 001-canonical-frontier

## Question

¿MCP, ACP o ambos deben definir la API de control?

## Answer

Un protocolo interno tipado define comandos y consultas. MCP lo expone por
stdio. ACP ya negocia servidores MCP, por lo que consume la misma superficie.
El bridge navegador-proceso usa loopback, token efímero y revision guards.

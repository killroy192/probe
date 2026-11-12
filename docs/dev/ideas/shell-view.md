we can introduce a shell view feature that will be availble via mcp and UI. This should allow to filter shells and sort them. 

For instance filter buy agent-waiting & date.

Shells can be labeled and then this labeling can be used for sorting / filtering.

V2: We need to rethink this idea to something bigger, something orchestrator-agent friendly. So not only human can jump into shell that in a 'wait' state or 'complete' state but orchestrator agent itself. When shell is occupied buy agent, we need a way that agent can send status / message back to the orchestrator. For instance saying "i'm done". Theoretically we can even provide 'vision' to the independant 

Also we need to support the use case when agent creates a worktree for subagent work there (now we only show when worktree repo is imported and shell is running there)

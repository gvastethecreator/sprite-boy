# Ownership de dependencias y lockfile

Type: task
Status: open
Blocked by: F8 dependency frontier; unresolved user-owned `package.json` diff

## Question

¿Qué cambios de dependencias requiere realmente F8 y cómo se aplican sin
sobrescribir el `package.json` que ya estaba modificado al iniciar la misión?

## Answer

Pendiente. No bloquea F1-F7 ni las tareas de producto que no agreguen paquetes;
se reclamará al llegar a la primera dependencia externa imprescindible.

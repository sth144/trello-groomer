import { ToDoGroomer } from "./groomer/todo.groomer";

process.on("unhandledRejection", (reason: any, p: Promise<any>) => {
    console.error(reason);
});

/**
 * create a ToDoGroomer object and run groomer
 */
ToDoGroomer().run();
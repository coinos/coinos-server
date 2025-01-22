#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define SOCKET_PATH "/sockets/ctrl"
#define INITIAL_BUFFER_SIZE 1024

void handle_client(const char *result_socket, const char *command, const char *data);

int main() {
    int server_fd, client_fd;
    struct sockaddr_un server_addr;

    // Unlink the socket file in case it exists
    unlink(SOCKET_PATH);

    server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (server_fd == -1) {
        perror("socket failed");
        exit(EXIT_FAILURE);
    }

    memset(&server_addr, 0, sizeof(struct sockaddr_un));
    server_addr.sun_family = AF_UNIX;
    strncpy(server_addr.sun_path, SOCKET_PATH, sizeof(server_addr.sun_path) - 1);

    if (bind(server_fd, (struct sockaddr *)&server_addr, sizeof(struct sockaddr_un)) == -1) {
        perror("bind failed");
        close(server_fd);
        exit(EXIT_FAILURE);
    }

    if (listen(server_fd, 5) == -1) {
        perror("listen failed");
        close(server_fd);
        exit(EXIT_FAILURE);
    }

    printf("Server listening on %s\n", SOCKET_PATH);

    while (1) {
        client_fd = accept(server_fd, NULL, NULL);
        if (client_fd == -1) {
            perror("accept failed");
            continue;
        }

        size_t buffer_size = INITIAL_BUFFER_SIZE;
        char *buffer = malloc(buffer_size);
        if (!buffer) {
            perror("malloc failed");
            close(client_fd);
            continue;
        }

        size_t total_bytes_read = 0;
        ssize_t num_bytes;

        while ((num_bytes = read(client_fd, buffer + total_bytes_read, buffer_size - total_bytes_read - 1)) > 0) {
            total_bytes_read += num_bytes;

            // Expand buffer if necessary
            if (total_bytes_read >= buffer_size - 1) {
                buffer_size *= 2;
                char *new_buffer = realloc(buffer, buffer_size);
                if (!new_buffer) {
                    perror("realloc failed");
                    free(buffer);
                    close(client_fd);
                    continue;
                }
                buffer = new_buffer;
            }
        }

        if (num_bytes == -1) {
            perror("read failed");
            free(buffer);
            close(client_fd);
            continue;
        }

        buffer[total_bytes_read] = '\0'; // Null-terminate the string

        printf("Received: %s\n", buffer);

        // Split message into result_socket, command, and data
        char *result_socket = strtok(buffer, " ");
        char *command = strtok(NULL, "\n");
        char *data = strtok(NULL, "");

        if (result_socket && command) {
            printf("Result socket: %s\n", result_socket);
            printf("Command: %s\n", command);
            if (data) {
                printf("Data: %s\n", data);
            }
            handle_client(result_socket, command, data);
        } else {
            fprintf(stderr, "Invalid input format\n");
        }

        free(buffer);
        close(client_fd);
    }

    close(server_fd);
    unlink(SOCKET_PATH);
    return 0;
}

void handle_client(const char *result_socket, const char *command, const char *data) {
    pid_t pid = fork();

    if (pid == 0) {
        int result_fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (result_fd == -1) {
            perror("result socket failed");
            exit(EXIT_FAILURE);
        }

        struct sockaddr_un result_addr;
        memset(&result_addr, 0, sizeof(struct sockaddr_un));
        result_addr.sun_family = AF_UNIX;
        strncpy(result_addr.sun_path, result_socket, sizeof(result_addr.sun_path) - 1);

        if (connect(result_fd, (struct sockaddr *)&result_addr, sizeof(struct sockaddr_un)) == -1) {
            perror("connect to result socket failed");
            close(result_fd);
            exit(EXIT_FAILURE);
        }

        int pipe_fd[2];
        if (pipe(pipe_fd) == -1) {
            perror("pipe failed");
            close(result_fd);
            exit(EXIT_FAILURE);
        }

        pid_t cmd_pid = fork();
        if (cmd_pid == 0) {
            // Child process: run the command
            dup2(pipe_fd[0], STDIN_FILENO); // Redirect stdin
            close(pipe_fd[0]);
            close(pipe_fd[1]);
            close(result_fd);

            execlp("/bin/sh", "sh", "-c", command, (char *)NULL);
            perror("execlp failed");
            exit(EXIT_FAILURE);
        }

        // Parent process: send data and collect output
        close(pipe_fd[0]); // Close read end of the pipe

        if (data) {
            write(pipe_fd[1], data, strlen(data));
        }
        close(pipe_fd[1]); // Close write end of the pipe

        FILE *cmd_output = fdopen(result_fd, "w");
        if (!cmd_output) {
            perror("fdopen failed");
            close(result_fd);
            exit(EXIT_FAILURE);
        }

        char output_buffer[INITIAL_BUFFER_SIZE];
        while (fgets(output_buffer, sizeof(output_buffer), cmd_output) != NULL) {
            write(result_fd, output_buffer, strlen(output_buffer));
        }

        fclose(cmd_output);
        shutdown(result_fd, SHUT_WR);
        close(result_fd);
        unlink(result_socket);
        exit(0);
    } else if (pid < 0) {
        perror("fork failed");
    }
}

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define SOCKET_PATH "/sockets/ctrl"
#define BUFFER_SIZE 1024

void handle_client(const char *result_socket, const char *command);

int main() {
  int server_fd, client_fd;
  struct sockaddr_un server_addr;
  char buffer[BUFFER_SIZE];

  unlink(SOCKET_PATH);

  server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server_fd == -1) {
    perror("socket failed");
    exit(EXIT_FAILURE);
  }

  memset(&server_addr, 0, sizeof(struct sockaddr_un));
  server_addr.sun_family = AF_UNIX;
  strncpy(server_addr.sun_path, SOCKET_PATH, sizeof(server_addr.sun_path) - 1);

  if (bind(server_fd, (struct sockaddr *)&server_addr,
           sizeof(struct sockaddr_un)) == -1) {
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

    memset(buffer, 0, BUFFER_SIZE);
    ssize_t num_bytes = read(client_fd, buffer, BUFFER_SIZE - 1);
    if (num_bytes > 0) {

      buffer[num_bytes] = '\0';

      printf("Received: %s\n", buffer);

      char result_socket[BUFFER_SIZE], command[BUFFER_SIZE];
      if (sscanf(buffer, "%s %[^\n]", result_socket, command) == 2) {
        printf("Result socket: %s\n", result_socket);
        printf("Command: %s\n", command);

        handle_client(result_socket, command);
      } else {
        fprintf(stderr, "Invalid input format\n");
      }
    }

    close(client_fd);
  }

  close(server_fd);
  unlink(SOCKET_PATH);
  return 0;
}

void handle_client(const char *result_socket, const char *command) {
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
    strncpy(result_addr.sun_path, result_socket,
            sizeof(result_addr.sun_path) - 1);

    if (connect(result_fd, (struct sockaddr *)&result_addr,
                sizeof(struct sockaddr_un)) == -1) {
      perror("connect to result socket failed");
      close(result_fd);
      exit(EXIT_FAILURE);
    }

    FILE *cmd_output = popen(command, "r");
    if (cmd_output == NULL) {
      perror("popen failed");
      close(result_fd);
      exit(EXIT_FAILURE);
    }

    char output_buffer[BUFFER_SIZE];
    while (fgets(output_buffer, sizeof(output_buffer), cmd_output) != NULL) {
      write(result_fd, output_buffer, strlen(output_buffer));
    }

    pclose(cmd_output);
    shutdown(result_fd, SHUT_WR);
    close(result_fd);
    unlink(result_socket);
    exit(0);
  } else if (pid < 0) {
    perror("fork failed");
  }
}

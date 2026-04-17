package com.jonessaif.cuedesk;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

public class ServerConfigActivity extends AppCompatActivity {

    private EditText hostInput;
    private EditText portInput;
    private TextView errorText;
    private Button connectButton;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server_config);

        hostInput = findViewById(R.id.serverHostInput);
        portInput = findViewById(R.id.serverPortInput);
        errorText = findViewById(R.id.serverErrorText);
        connectButton = findViewById(R.id.serverConnectButton);

        prefillFromSavedServer();

        connectButton.setOnClickListener(v -> connectToServer());
    }

    private void prefillFromSavedServer() {
        String savedUrl = MainActivity.readServerUrl(this);
        if (savedUrl == null) {
            portInput.setText("3000");
            return;
        }

        Uri uri = Uri.parse(savedUrl);
        String host = uri.getHost();
        int port = uri.getPort();
        if (host != null) {
            hostInput.setText(host);
        }
        portInput.setText(port > 0 ? String.valueOf(port) : "3000");
    }

    private void connectToServer() {
        String host = hostInput.getText().toString().trim();
        String portRaw = portInput.getText().toString().trim();

        if (host.isEmpty()) {
            errorText.setText("Enter server IP or hostname");
            return;
        }

        int port;
        try {
            port = Integer.parseInt(portRaw);
        } catch (NumberFormatException ex) {
            errorText.setText("Port must be a valid number");
            return;
        }

        if (port < 1 || port > 65535) {
            errorText.setText("Port must be between 1 and 65535");
            return;
        }

        errorText.setText("");
        connectButton.setEnabled(false);
        connectButton.setText("Checking...");

        String serverUrl = "http://" + host + ":" + port;
        final int validatedPort = port;
        new Thread(() -> {
            boolean reachable = isHostReachable(host, validatedPort);
            runOnUiThread(() -> {
                if (!reachable) {
                    errorText.setText("Cannot connect to server. Check IP/port and try again.");
                    connectButton.setEnabled(true);
                    connectButton.setText("Save and Connect");
                    return;
                }

                Intent openMain = new Intent(this, MainActivity.class);
                openMain.putExtra(MainActivity.EXTRA_SERVER_URL, serverUrl);
                openMain.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(openMain);
                finish();
            });
        }).start();
    }

    private boolean isHostReachable(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 1800);
            return true;
        } catch (IOException ex) {
            return false;
        }
    }
}

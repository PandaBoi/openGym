package ch.duartesantos.opengym;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import ch.duartesantos.opengym.voice.VoiceAssistantPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins are not auto-discovered from capacitor.plugins.json — register here.
        registerPlugin(VoiceAssistantPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

{{/* Traffic coming from the Ingress controller: its namespace AND its pod label, together. */}}
{{- define "np.fromIngressController" -}}
- namespaceSelector:
    matchLabels:
      kubernetes.io/metadata.name: {{ .Values.ingressController.namespace }}
  podSelector:
    matchLabels:
      {{- toYaml .Values.ingressController.podLabels | nindent 6 }}
{{- end }}

{{/* Traffic to the public internet only (private ranges excluded). */}}
{{- define "np.toInternet" -}}
- to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
          {{- toYaml .Values.internetEgress.exceptCidrs | nindent 10 }}
  ports:
    {{- range .Values.internetEgress.ports }}
    - port: {{ . }}
      protocol: TCP
    {{- end }}
{{- end }}

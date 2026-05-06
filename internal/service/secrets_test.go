package service

import "testing"

func TestSecretsServiceResolveAndIsResolvable(t *testing.T) {
	s := NewSecretsService()
	t.Setenv("OW_TEST_KEY", " value ")
	if got, ok := s.Resolve("OW_TEST_KEY"); !ok || got != "value" {
		t.Fatalf("Resolve present = %q %v", got, ok)
	}
	if s.IsResolvable("MISSING_KEY") {
		t.Fatal("missing key should not be resolvable")
	}
	if _, ok := s.Resolve("not-valid-name!"); ok {
		t.Fatal("invalid env name should not resolve")
	}
}

func TestSecretsServiceCheckByName(t *testing.T) {
	s := NewSecretsService()
	t.Setenv("OW_CHECK_KEY", "secret")
	name, present, err := s.CheckByName(" OW_CHECK_KEY ")
	if err != nil || name != "OW_CHECK_KEY" || !present {
		t.Fatalf("CheckByName present = name=%q present=%v err=%v", name, present, err)
	}
	if _, _, err := s.CheckByName("bad-name"); err == nil {
		t.Fatal("expected invalid env var error")
	}
}

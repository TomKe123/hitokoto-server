package setup

import (
	"os"
)

const initializedFile = ".initialized"

func Needed() bool {
	_, err := os.Stat(initializedFile)
	return os.IsNotExist(err)
}

func MarkDone() {
	os.WriteFile(initializedFile, []byte{}, 0644)
}

func Reset() error {
	err := os.Remove(initializedFile)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

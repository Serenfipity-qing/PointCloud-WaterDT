"""
统一模型推理接口。
支持 PointNet，后续可替换为其他模型，不影响上层系统。
"""
import abc
import sys
import os
import numpy as np
import torch

from ..config import (
    MODEL_CHECKPOINT, NUM_CLASSES, NUM_POINT, BLOCK_SIZE, BATCH_SIZE, POINTNET_DIR
)
from .pointcloud_loader import preprocess_for_inference


class BaseSegModel(abc.ABC):
    """语义分割模型的统一抽象接口"""

    @abc.abstractmethod
    def load(self, checkpoint_path: str):
        ...

    @abc.abstractmethod
    def predict(self, points: np.ndarray) -> np.ndarray:
        """
        输入: (N, >=6) 点云 (xyz + rgb [+ label])
        输出: (N,) 每个点的预测类别 id
        """
        ...


class PointNetSegModel(BaseSegModel):
    """基于你训练好的 PointNet 的语义分割模型"""

    def __init__(self):
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def load(self, checkpoint_path: str = MODEL_CHECKPOINT):
        # 将 pointnet/models 加入 sys.path 以便 import
        models_dir = os.path.join(POINTNET_DIR, "models")
        if models_dir not in sys.path:
            sys.path.insert(0, models_dir)

        from pointnet_sem_seg import get_model  # type: ignore
        self.model = get_model(NUM_CLASSES).to(self.device)
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()
        return self

    def predict(self, points: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("模型未加载，请先调用 load()")

        num_points = points.shape[0]
        stride = BLOCK_SIZE / 2
        batched_data, point_indices = preprocess_for_inference(
            points, block_size=BLOCK_SIZE, num_point=NUM_POINT, stride=stride
        )

        vote_pool = np.zeros((num_points, NUM_CLASSES), dtype=np.float32)
        total_blocks = batched_data.shape[0]

        with torch.no_grad():
            for start in range(0, total_blocks, BATCH_SIZE):
                end = min(start + BATCH_SIZE, total_blocks)
                batch = torch.from_numpy(batched_data[start:end]).float().to(self.device)
                batch = batch.transpose(2, 1)  # (B, 9, N)
                seg_pred, _ = self.model(batch)
                pred_labels = seg_pred.cpu().numpy().argmax(axis=2)  # (B, N)

                idx_batch = point_indices[start:end]
                for b in range(pred_labels.shape[0]):
                    for n in range(pred_labels.shape[1]):
                        vote_pool[int(idx_batch[b, n]), int(pred_labels[b, n])] += 1

        return vote_pool.argmax(axis=1)


# 全局模型实例（单例）
_model_instance: BaseSegModel | None = None


def get_model_instance() -> BaseSegModel:
    global _model_instance
    if _model_instance is None:
        _model_instance = PointNetSegModel()
        _model_instance.load()
    return _model_instance
